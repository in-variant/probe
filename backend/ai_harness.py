"""
AI Harness for document retrieval.
- Accepts a natural language query + workspace ID
- Scans workspace documents from local cache
- Uses OpenAI to find the most relevant documents
- Persists chat transcripts and agent traces under the workspace prefix
"""

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(Path(__file__).parent / ".env")

import local_cache
from rag.retriever import citations_text, retrieve
from rag.types import RagHit
from storage import workspace_prefix, read_json_blob, write_json_blob, workspace_meta_path

logger = logging.getLogger(__name__)

OPENAI_MODEL = "gpt-4.1-mini"

_openai_client: OpenAI | None = None


def _get_openai_client() -> OpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
    return _openai_client


_FENCE_RE = re.compile(r"^```(?:\w*)\s*\n(.*?)```\s*$", re.DOTALL)


def _strip_markdown_fences(text: str) -> str:
    m = _FENCE_RE.match(text)
    if m:
        return m.group(1).strip()
    return text


def _collect_documents(workspace_id: str) -> list[dict[str, Any]]:
    """Recursively collect all file metadata from a workspace's local cache."""
    prefix = workspace_prefix(workspace_id).rstrip("/")
    documents: list[dict[str, Any]] = []

    def _walk(rel_path: str):
        dirs, files = local_cache.list_dir(rel_path)
        for fname in files:
            if fname.startswith("."):
                continue
            file_rel = f"{rel_path}/{fname}"
            meta = local_cache.read_metadata(file_rel)
            size = local_cache.get_file_size(file_rel)
            doc_path = file_rel[len(prefix):]
            documents.append({
                "name": fname,
                "path": doc_path,
                "size": size,
                "content_type": meta.get("content_type", ""),
                "status": meta.get("status", ""),
                "original_name": meta.get("original_name", fname),
            })
        for d in dirs:
            if d.startswith("."):
                continue
            _walk(f"{rel_path}/{d}")

    _walk(prefix)
    return documents


SYSTEM_PROMPT = """You are a document retrieval assistant. Given a list of documents in a workspace and a user query, return the most relevant documents as a JSON array.

Each element must have:
- "path": the document path
- "name": the document name  
- "relevance": a short explanation of why this document is relevant
- "score": relevance score from 0.0 to 1.0

Return ONLY valid JSON — no markdown fencing, no explanation outside the array.
If no documents match, return an empty array [].
Sort by score descending. Return at most 20 results."""

SUMMARY_SYSTEM_PROMPT = """You are a precise information retrieval assistant. You will be given document contents and a user query. Your job is to produce a short, direct answer to the query based solely on the provided documents.

Format your response in clean markdown:
- Use **bold** for key terms or values.
- Use bullet points for lists of facts.
- Use `code` formatting for technical identifiers, file names, or values.
- Use headings (##, ###) only if the answer has distinct sections.
- Keep paragraphs short (1-2 sentences each).

Rules:
- Be precise and to the point. No filler, no fluff.
- Do not use em dashes.
- Use plain, clear language.
- If the documents contain a direct answer, state it.
- If they contain partial or indirect information, say what is available.
- If nothing relevant is found, say so in one sentence.
- Keep the summary under 150 words.
- Do not repeat the query back. Just answer it."""

RESEARCH_SUMMARY_SYSTEM_PROMPT = """You are a research-grade document analysis assistant. You will be given retrieved excerpts from multiple documents and a user query.

Produce a detailed, well-structured markdown answer based only on the provided excerpts.

Format:
- Use clear headings and subheadings.
- Separate sections with concise paragraphs.
- Include concrete values, constraints, assumptions, and implications when present.
- Mention gaps or uncertainties if the excerpts do not fully answer something.
- Do not invent facts.
- Do not use em dashes.
- Do not repeat the query back.

Target depth: 800-1400 words when the evidence supports it."""

RESEARCH_DECOMPOSE_SYSTEM_PROMPT = """You break a research question into 3 to 6 focused sub-questions for searching technical documents.
Return ONLY a JSON array of strings. Each element is one short sub-question (plain text, no numbering prefix).
If the question is narrow, still return 3 sub-questions that explore distinct angles (definitions, constraints, operations, risks, etc.).
Do not use markdown fences or any text outside the JSON array."""

RESEARCH_SECTION_SYSTEM_PROMPT = """You answer exactly ONE sub-question using only the provided document excerpts.

Write a detailed markdown section (about 300-700 words when the evidence supports it) with:
- A ### heading that briefly restates the sub-question
- Short paragraphs; bullets where helpful
- Concrete values and constraints when present
- Note gaps if excerpts are insufficient

Rules: do not invent facts. Do not use em dashes. Use only the excerpts."""

MAX_CONTENT_BYTES_PER_FILE = 30_000
MAX_FILES_FOR_SUMMARY = 5
EXTRACTED_TEXT_DIR = ".extracted_text"


def _is_research_query(query: str) -> bool:
    return "agent mode: research" in query.lower()


def _core_query_for_research(query: str) -> str:
    """Strip agent-mode boilerplate and referenced-file lists so decomposition sees the user's ask."""
    lines_out: list[str] = []
    skipping_refs = False
    for line in query.split("\n"):
        stripped = line.strip()
        lower_stripped = stripped.lower()
        if lower_stripped.startswith("referenced files:"):
            skipping_refs = True
            continue
        if skipping_refs:
            if stripped.startswith("- "):
                continue
            if stripped == "":
                skipping_refs = False
                continue
            skipping_refs = False
        if "agent mode:" in stripped.lower():
            continue
        if lower_stripped.startswith("return a clean markdown"):
            break
        lines_out.append(line)
    return "\n".join(lines_out).strip()


def _decompose_research_query(user_query: str) -> list[str]:
    core = _core_query_for_research(user_query)
    if len(core) < 8:
        return []
    try:
        client = _get_openai_client()
        completion = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": RESEARCH_DECOMPOSE_SYSTEM_PROMPT},
                {"role": "user", "content": core},
            ],
            temperature=0.15,
            max_tokens=500,
        )
        raw = _strip_markdown_fences((completion.choices[0].message.content or "").strip())
        data = json.loads(raw)
        if not isinstance(data, list):
            return []
        out = [str(item).strip() for item in data if str(item).strip()]
        return out[:8]
    except Exception:
        logger.exception("Research query decomposition failed")
        return []


def _summarize_research_section(sub_query: str, hits: list[RagHit]) -> str:
    if not hits:
        return ""
    chars_per_hit = 2800
    file_sections = [
        f"--- {hit.path.lstrip('/')} chunk {hit.chunk_index} ---\n{hit.text[:chars_per_hit]}"
        for hit in hits[:10]
        if hit.text.strip()
    ]
    if not file_sections:
        return ""
    user_msg = f"Sub-question: {sub_query}\n\nRetrieved document excerpts:\n{chr(10).join(file_sections)}"
    try:
        client = _get_openai_client()
        completion = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": RESEARCH_SECTION_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.1,
            max_tokens=900,
        )
        return (completion.choices[0].message.content or "").strip()
    except Exception:
        logger.exception("Research section summary failed")
        return ""


def _research_deep_pipeline(
    workspace_id: str, query: str, seed_hits: list[RagHit]
) -> tuple[str, list[RagHit]] | None:
    """Multi-step research: decompose query, retrieve per sub-question, merge evidence, section summaries."""
    subqs = _decompose_research_query(query)
    if len(subqs) < 2:
        return None
    merged: dict[str, RagHit] = {hit.chunk_id: hit for hit in seed_hits}
    sections: list[str] = []
    for subq in subqs:
        try:
            sub_hits = retrieve(workspace_id, subq, top_k=8)
        except Exception:
            logger.exception("Per-subquery retrieve failed")
            sub_hits = []
        for hit in sub_hits:
            merged.setdefault(hit.chunk_id, hit)
        body = _summarize_research_section(subq, sub_hits)
        if body:
            heading = subq.strip()
            if len(heading) > 100:
                heading = heading[:97] + "..."
            sections.append(f"## {heading}\n\n{body}")
    if not sections:
        return None
    merged_hits = sorted(merged.values(), key=lambda item: item.score, reverse=True)
    summary_body = "\n\n".join(sections)
    source_block = citations_text(merged_hits)
    summary = f"{summary_body}{source_block}" if source_block else summary_body
    return summary, merged_hits


def _read_file_text(workspace_id: str, doc_path: str) -> str | None:
    """Read a file from the local cache and return its text content, or None."""
    prefix = workspace_prefix(workspace_id).rstrip("/")
    clean_path = doc_path.lstrip("/")
    sidecar_path = f"{prefix}/{EXTRACTED_TEXT_DIR}/{clean_path}.txt"
    sidecar = local_cache.read_file(sidecar_path)
    if sidecar:
        try:
            return sidecar[:MAX_CONTENT_BYTES_PER_FILE].decode("utf-8", errors="replace")
        except Exception:
            return None
    rel_path = f"{prefix}/{clean_path}"
    raw = local_cache.read_file(rel_path)
    if raw is None:
        return None
    raw = raw[:MAX_CONTENT_BYTES_PER_FILE]
    try:
        decoded = raw.decode("utf-8", errors="replace")
        if decoded.lstrip().startswith("%PDF-"):
            return None
        return decoded
    except Exception:
        return None


def _generate_summary_from_hits(query: str, hits: list[RagHit]) -> str:
    if not hits:
        return ""
    research = _is_research_query(query)
    max_hits = 12 if research else MAX_FILES_FOR_SUMMARY
    chars_per_hit = 3200 if research else 2200
    file_sections = [
        f"--- {hit.path.lstrip('/')} chunk {hit.chunk_index} ---\n{hit.text[:chars_per_hit]}"
        for hit in hits[:max_hits]
        if hit.text.strip()
    ]
    if not file_sections:
        return ""
    user_msg = f"Query: {query}\n\nRetrieved document excerpts:\n{chr(10).join(file_sections)}"
    try:
        client = _get_openai_client()
        completion = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": RESEARCH_SUMMARY_SYSTEM_PROMPT if research else SUMMARY_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.1,
            max_tokens=1600 if research else 300,
        )
        return (completion.choices[0].message.content or "").strip()
    except Exception:
        logger.exception("Summary generation failed")
        return ""


def _generate_summary(query: str, results: list[dict[str, Any]], workspace_id: str) -> str:
    """Read top matched files and ask the LLM for a precise summary."""
    if not results:
        return ""

    file_sections: list[str] = []
    for r in results[:MAX_FILES_FOR_SUMMARY]:
        text = _read_file_text(workspace_id, r.get("path", ""))
        if not text or not text.strip():
            continue
        file_sections.append(f"--- {r.get('name', 'unknown')} ---\n{text}")

    if not file_sections:
        return ""

    combined = "\n\n".join(file_sections)
    user_msg = f"Query: {query}\n\nDocument contents:\n{combined}"

    try:
        client = _get_openai_client()
        completion = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.1,
            max_tokens=300,
        )
        return (completion.choices[0].message.content or "").strip()
    except Exception:
        logger.exception("Summary generation failed")
        return ""


def _build_user_prompt(query: str, documents: list[dict[str, Any]]) -> str:
    doc_listing = "\n".join(
        f"- path: {d['path']} | name: {d['original_name'] or d['name']} | "
        f"type: {d['content_type']} | size: {d['size']} | status: {d['status']}"
        for d in documents
    )
    return f"""Documents in workspace:
{doc_listing}

User query: "{query}" """


def _slugify_chat_name(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return (slug[:48].strip("-") or "chat")


def _safe_session_id(session_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "-", session_id).strip("-")[:80] or "session"


def _find_chat_path(workspace_id: str, session_id: str) -> str | None:
    chat_dir = f"{workspace_prefix(workspace_id)}.chats"
    _, files = local_cache.list_dir(chat_dir)
    for filename in files:
        if not filename.endswith(".json"):
            continue
        path = f"{chat_dir}/{filename}"
        data = read_json_blob(path)
        if data and data.get("session_id") == session_id:
            return path
    return None


def _upsert_chat(
    workspace_id: str,
    session_id: str,
    timestamp: str,
    request_payload: dict[str, Any],
    response_payload: dict[str, Any],
) -> str:
    """Append a user-visible turn to the workspace chat transcript."""
    chat_path = _find_chat_path(workspace_id, session_id)
    if chat_path:
        chat = read_json_blob(chat_path) or {}
    else:
        slug = _slugify_chat_name(str(request_payload.get("query", "")))
        chat_path = f"{workspace_prefix(workspace_id)}.chats/{slug}-{_safe_session_id(session_id)}.json"
        chat = {
            "session_id": session_id,
            "workspace_id": workspace_id,
            "title": slug.replace("-", " ").title(),
            "created_at": timestamp,
            "turns": [],
        }

    turns = chat.get("turns")
    if not isinstance(turns, list):
        turns = []
    turns.append({
        "interaction_id": request_payload.get("interaction_id"),
        "timestamp": timestamp,
        "user": request_payload.get("query", ""),
        "assistant": {
            "message": response_payload.get("message", ""),
            "summary": response_payload.get("summary", ""),
            "results": response_payload.get("results", []),
        },
    })
    chat["turns"] = turns
    chat["updated_at"] = timestamp
    write_json_blob(chat_path, chat)
    return chat_path


def _hit_trace(hit: RagHit) -> dict[str, Any]:
    trace = {
        "chunk_id": hit.chunk_id,
        "path": hit.path,
        "chunk_index": hit.chunk_index,
        "score": round(hit.score, 6),
        "preview": hit.text[:500],
    }
    content_hash = hit.metadata.get("content_hash") if isinstance(hit.metadata, dict) else None
    if content_hash:
        trace["content_hash"] = content_hash
    return trace


def search_documents(workspace_id: str, query: str, session_id: str) -> dict[str, Any]:
    """
    Run an AI-powered document search against a workspace.
    Returns the search results and logs the interaction to GCS.
    Each interaction is uniquely identified and grouped by session_id.
    """
    interaction_id = str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).isoformat()

    ws_meta = read_json_blob(workspace_meta_path(workspace_id))
    workspace_name = ws_meta.get("name", workspace_id) if ws_meta else workspace_id

    documents = _collect_documents(workspace_id)

    request_payload = {
        "interaction_id": interaction_id,
        "session_id": session_id,
        "timestamp": timestamp,
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
        "query": query,
        "document_count": len(documents),
    }

    if not documents:
        response_payload = {
            "results": [],
            "message": "No documents found in this workspace.",
        }
        paths = _log_interaction(workspace_id, interaction_id, session_id, timestamp, request_payload, response_payload)
        return {"interaction_id": interaction_id, **paths, **response_payload}

    research = _is_research_query(query)
    try:
        hits = retrieve(workspace_id, query, top_k=16 if research else 8)
        if research:
            expanded_hits: dict[str, RagHit] = {hit.chunk_id: hit for hit in hits}
            for suffix in (
                "requirements constraints assumptions",
                "technical parameters values frequencies operations",
                "risks gaps recommendations implications",
            ):
                for hit in retrieve(workspace_id, f"{query}\n{suffix}", top_k=8):
                    expanded_hits.setdefault(hit.chunk_id, hit)
            hits = sorted(expanded_hits.values(), key=lambda item: item.score, reverse=True)[:24]
    except Exception:
        logger.exception("[%s] Chroma retrieval failed", interaction_id[:8])
        hits = []

    if hits:
        hits_for_summary = hits
        if research:
            deep = _research_deep_pipeline(workspace_id, query, hits)
            if deep:
                summary, hits_for_summary = deep
                source_block = ""
            else:
                summary = _generate_summary_from_hits(query, hits)
                source_block = citations_text(hits)
                if source_block and summary:
                    summary = f"{summary}{source_block}"
                elif source_block:
                    summary = source_block.strip()
                hits_for_summary = hits
        else:
            summary = _generate_summary_from_hits(query, hits)
            source_block = citations_text(hits)
            if source_block and summary:
                summary = f"{summary}{source_block}"
            elif source_block:
                summary = source_block.strip()
            hits_for_summary = hits

        by_path: dict[str, dict[str, Any]] = {}
        for hit in hits_for_summary:
            clean_path = hit.path.lstrip("/")
            existing = by_path.get(clean_path)
            if existing is None or hit.score > existing["score"]:
                matched_doc = next((d for d in documents if d["path"].lstrip("/") == clean_path), {})
                by_path[clean_path] = {
                    "path": f"/{clean_path}",
                    "name": matched_doc.get("name") or Path(clean_path).name,
                    "relevance": "Retrieved from indexed document content.",
                    "score": round(hit.score, 4),
                    "size": matched_doc.get("size"),
                    "content_type": matched_doc.get("content_type"),
                    "status": matched_doc.get("status"),
                }
        results = sorted(by_path.values(), key=lambda item: item["score"], reverse=True)
        if not summary:
            summary = source_block.strip() if source_block else ""
        response_payload = {
            "results": results,
            "message": f"Found {len(results)} relevant document(s).",
            "summary": summary,
        }
        trace_metadata = {"retrieval": {"mode": "rag", "hits": [_hit_trace(hit) for hit in hits_for_summary]}}
        paths = _log_interaction(
            workspace_id,
            interaction_id,
            session_id,
            timestamp,
            request_payload,
            response_payload,
            trace_metadata,
        )
        return {"interaction_id": interaction_id, **paths, **response_payload}

    user_prompt = _build_user_prompt(query, documents)
    error_message = ""

    try:
        client = _get_openai_client()
        logger.info("[%s] Calling OpenAI document selector with docs=%s", interaction_id[:8], len(documents))

        completion = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
        )

        raw_text = (completion.choices[0].message.content or "").strip()
        logger.info("[%s] OpenAI selector response chars=%s", interaction_id[:8], len(raw_text))

        raw_text = _strip_markdown_fences(raw_text)
        results = json.loads(raw_text)
        if not isinstance(results, list):
            results = []

    except json.JSONDecodeError as e:
        logger.warning(f"[{interaction_id[:8]}] OpenAI returned non-JSON: {e}")
        error_message = "AI returned an unparseable response. Please try again."
        results = []
    except Exception as e:
        logger.exception(f"[{interaction_id[:8]}] OpenAI call failed")
        error_message = f"AI search failed: {type(e).__name__}: {e}"
        results = []

    for r in results:
        matched_doc = next((d for d in documents if d["path"] == r.get("path")), None)
        if matched_doc:
            r["size"] = matched_doc.get("size")
            r["content_type"] = matched_doc.get("content_type")
            r["status"] = matched_doc.get("status")

    summary = ""
    if results and not error_message:
        summary = _generate_summary(query, results, workspace_id)

    if error_message:
        message = error_message
    elif results:
        message = f"Found {len(results)} relevant document(s)."
    else:
        message = "No documents matched your query. Try rephrasing."

    response_payload = {"results": results, "message": message, "summary": summary}
    trace_metadata = {
        "retrieval": {
            "mode": "selector",
            "document_count": len(documents),
            "selected_results": response_payload.get("results", []),
        },
        "error": error_message or None,
    }
    paths = _log_interaction(
        workspace_id,
        interaction_id,
        session_id,
        timestamp,
        request_payload,
        response_payload,
        trace_metadata,
    )

    return {"interaction_id": interaction_id, **paths, **response_payload}


def _log_interaction(
    workspace_id: str,
    interaction_id: str,
    session_id: str,
    timestamp: str,
    request_payload: dict,
    response_payload: dict,
    trace_metadata: dict[str, Any] | None = None,
):
    """Persist chat and trace records through the workspace storage path."""
    trace_path = f"{workspace_prefix(workspace_id)}.traces/{interaction_id}.json"
    chat_path = _upsert_chat(workspace_id, session_id, timestamp, request_payload, response_payload)

    trace_record = {
        "interaction_id": interaction_id,
        "session_id": session_id,
        "timestamp": timestamp,
        "workspace_id": workspace_id,
        "request": request_payload,
        "response": response_payload,
        "trace": trace_metadata or {},
    }
    write_json_blob(trace_path, trace_record)
    return {"chat_path": chat_path, "trace_path": trace_path}
