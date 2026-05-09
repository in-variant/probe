"""
AI Harness for document retrieval.
- Accepts a natural language query + workspace ID
- Scans workspace documents from local cache
- Uses OpenAI to find the most relevant documents
- Logs every interaction (request + response) as JSON to GCS bucket
  `probe-information-retrieval` under folder `akashalabdhi/`
- Upload is async (background thread), local JSON is deleted after upload
"""

import json
import logging
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(Path(__file__).parent / ".env")

import local_cache
from gcs_client import get_client
from rag.retriever import citations_text, retrieve
from rag.types import RagHit
from storage import workspace_prefix, read_json_blob, workspace_meta_path

logger = logging.getLogger(__name__)

IR_BUCKET_NAME = "probe-information-retrieval"
IR_FOLDER = "akashalabdhi"
IR_LOCAL_DIR = Path("/tmp/probe-ir-logs")

OPENAI_MODEL = "gpt-4.1-mini"

_openai_client: OpenAI | None = None


def _get_openai_client() -> OpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
    return _openai_client


def _ensure_ir_dir():
    IR_LOCAL_DIR.mkdir(parents=True, exist_ok=True)


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

MAX_CONTENT_BYTES_PER_FILE = 30_000
MAX_FILES_FOR_SUMMARY = 5
EXTRACTED_TEXT_DIR = ".extracted_text"


def _is_research_query(query: str) -> bool:
    return "agent mode: research" in query.lower()


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


def _upload_interaction_async(local_path: Path, gcs_key: str):
    """Upload the interaction JSON to GCS and delete the local file."""
    try:
        client = get_client()
        bucket = client.bucket(IR_BUCKET_NAME)
        blob = bucket.blob(gcs_key)
        blob.upload_from_filename(str(local_path), content_type="application/json")
        logger.info(f"IR log uploaded: {gcs_key}")
    except Exception:
        logger.exception(f"Failed to upload IR log: {gcs_key}")
    finally:
        try:
            local_path.unlink(missing_ok=True)
        except Exception:
            pass


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
        _log_interaction(interaction_id, session_id, timestamp, request_payload, response_payload)
        return {"interaction_id": interaction_id, **response_payload}

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
        by_path: dict[str, dict[str, Any]] = {}
        for hit in hits:
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
        summary = _generate_summary_from_hits(query, hits)
        source_block = citations_text(hits)
        if source_block and summary:
            summary = f"{summary}{source_block}"
        elif source_block:
            summary = source_block.strip()
        response_payload = {
            "results": results,
            "message": f"Found {len(results)} relevant document(s).",
            "summary": summary,
        }
        _log_interaction(interaction_id, session_id, timestamp, request_payload, response_payload)
        return {"interaction_id": interaction_id, **response_payload}

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
    _log_interaction(interaction_id, session_id, timestamp, request_payload, response_payload)

    return {"interaction_id": interaction_id, **response_payload}


def _log_interaction(
    interaction_id: str,
    session_id: str,
    timestamp: str,
    request_payload: dict,
    response_payload: dict,
):
    """Write interaction JSON locally, then upload to GCS in a background thread."""
    _ensure_ir_dir()

    interaction_record = {
        "interaction_id": interaction_id,
        "session_id": session_id,
        "timestamp": timestamp,
        "request": request_payload,
        "response": response_payload,
    }

    local_path = IR_LOCAL_DIR / f"{interaction_id}.json"
    local_path.write_text(json.dumps(interaction_record, indent=2, default=str), encoding="utf-8")

    gcs_key = f"{IR_FOLDER}/{session_id}/{interaction_id}.json"
    thread = threading.Thread(
        target=_upload_interaction_async,
        args=(local_path, gcs_key),
        daemon=True,
        name=f"ir-upload-{interaction_id[:8]}",
    )
    thread.start()
