from __future__ import annotations

import logging
import time
from pathlib import PurePosixPath

import local_cache
from rag.chunker import build_chunks
from rag.chroma_store import get_store
from rag.embedder import embed_texts
from rag.types import IndexResult
from storage import workspace_prefix

logger = logging.getLogger(__name__)

EXTRACTED_TEXT_DIR = ".extracted_text"
TEXT_EXTENSIONS = {
    "txt", "md", "markdown", "json", "yaml", "yml", "xml", "csv", "log",
    "py", "js", "jsx", "ts", "tsx", "java", "go", "rb", "php", "sql", "html", "css", "probe",
}


def _decode_bytes(raw: bytes) -> str:
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


def _sidecar_path(workspace_id: str, path: str) -> str:
    prefix = workspace_prefix(workspace_id)
    return f"{prefix}{EXTRACTED_TEXT_DIR}/{path.lstrip('/')}.txt"


def read_indexable_text(workspace_id: str, path: str) -> str:
    sidecar = local_cache.read_file(_sidecar_path(workspace_id, path))
    if sidecar:
        return _decode_bytes(sidecar).strip()

    ext = PurePosixPath(path).suffix.lstrip(".").lower()
    if ext not in TEXT_EXTENSIONS:
        return ""
    raw = local_cache.read_file(f"{workspace_prefix(workspace_id)}{path.lstrip('/')}")
    if not raw:
        return ""
    decoded = _decode_bytes(raw)
    if decoded.lstrip().startswith("%PDF-"):
        return ""
    return decoded.strip()


def is_indexable_path(path: str) -> bool:
    name = PurePosixPath(path).name
    if not name or name.startswith("."):
        return False
    if f"/{EXTRACTED_TEXT_DIR}/" in f"/{path}":
        return False
    ext = PurePosixPath(path).suffix.lstrip(".").lower()
    return ext in TEXT_EXTENSIONS or ext in {"pdf", "docx", "xlsx"}


def index_file(workspace_id: str, path: str) -> IndexResult:
    started = time.monotonic()
    clean_path = path.lstrip("/")
    try:
        if not is_indexable_path(clean_path):
            return IndexResult(workspace_id, clean_path, "skipped", 0)
        text = read_indexable_text(workspace_id, clean_path)
        store = get_store()
        store.delete_path(workspace_id, f"/{clean_path}")
        store.delete_path(workspace_id, clean_path)
        if not text:
            logger.info("rag_index_empty workspace=%s path=%s duration_ms=%s", workspace_id, clean_path, int((time.monotonic() - started) * 1000))
            return IndexResult(workspace_id, clean_path, "empty", 0)
        chunks = build_chunks(workspace_id, f"/{clean_path}", text)
        embeddings = embed_texts([c.text for c in chunks])
        store.upsert_chunks(workspace_id, chunks, embeddings)
        logger.info(
            "rag_index_file workspace=%s path=%s chunks=%s duration_ms=%s",
            workspace_id,
            clean_path,
            len(chunks),
            int((time.monotonic() - started) * 1000),
        )
        return IndexResult(workspace_id, clean_path, "indexed", len(chunks))
    except Exception as exc:
        logger.exception("rag_index_file_failed workspace=%s path=%s error=%s", workspace_id, clean_path, type(exc).__name__)
        return IndexResult(workspace_id, clean_path, "error", 0, str(exc))


def delete_indexed_path(workspace_id: str, path: str) -> None:
    clean_path = path.lstrip("/")
    get_store().delete_path(workspace_id, f"/{clean_path}")
    get_store().delete_path(workspace_id, clean_path)


def list_workspace_files(workspace_id: str) -> list[str]:
    prefix = workspace_prefix(workspace_id)
    files = local_cache.list_all_files(prefix.rstrip("/"))
    out: list[str] = []
    for file_path in files:
        rel = file_path[len(prefix):].lstrip("/")
        if is_indexable_path(rel):
            out.append(rel)
    return out

