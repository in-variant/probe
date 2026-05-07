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


def search_documents(workspace_id: str, query: str) -> dict[str, Any]:
    """
    Run an AI-powered document search against a workspace.
    Returns the search results and logs the interaction to GCS.
    """
    interaction_id = str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).isoformat()

    ws_meta = read_json_blob(workspace_meta_path(workspace_id))
    workspace_name = ws_meta.get("name", workspace_id) if ws_meta else workspace_id

    documents = _collect_documents(workspace_id)

    request_payload = {
        "interaction_id": interaction_id,
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
        _log_interaction(interaction_id, timestamp, request_payload, response_payload)
        return {"interaction_id": interaction_id, **response_payload}

    user_prompt = _build_user_prompt(query, documents)
    error_message = ""

    try:
        client = _get_openai_client()
        logger.info(f"[{interaction_id[:8]}] Calling OpenAI with {len(documents)} docs, query: {query!r}")

        completion = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
        )

        raw_text = (completion.choices[0].message.content or "").strip()
        logger.info(f"[{interaction_id[:8]}] Raw response ({len(raw_text)} chars): {raw_text[:200]!r}")

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

    if error_message:
        message = error_message
    elif results:
        message = f"Found {len(results)} relevant document(s)."
    else:
        message = "No documents matched your query. Try rephrasing."

    response_payload = {"results": results, "message": message}
    _log_interaction(interaction_id, timestamp, request_payload, response_payload)

    return {"interaction_id": interaction_id, **response_payload}


def _log_interaction(
    interaction_id: str,
    timestamp: str,
    request_payload: dict,
    response_payload: dict,
):
    """Write interaction JSON locally, then upload to GCS in a background thread."""
    _ensure_ir_dir()

    interaction_record = {
        "interaction_id": interaction_id,
        "timestamp": timestamp,
        "request": request_payload,
        "response": response_payload,
    }

    local_path = IR_LOCAL_DIR / f"{interaction_id}.json"
    local_path.write_text(json.dumps(interaction_record, indent=2, default=str), encoding="utf-8")

    gcs_key = f"{IR_FOLDER}/{interaction_id}.json"
    thread = threading.Thread(
        target=_upload_interaction_async,
        args=(local_path, gcs_key),
        daemon=True,
        name=f"ir-upload-{interaction_id[:8]}",
    )
    thread.start()
