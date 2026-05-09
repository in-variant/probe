from pathlib import Path

import local_cache
from rag.chroma_store import ChromaStore, set_store_for_tests
from rag.indexer import index_file, read_indexable_text
from storage import workspace_prefix, write_file_blob


def _use_store(tmp_path: Path) -> ChromaStore:
    store = ChromaStore(tmp_path / "chroma")
    set_store_for_tests(store)
    return store


def test_index_file_is_idempotent(tmp_path):
    store = _use_store(tmp_path)
    prefix = workspace_prefix("ws-rag-idem")
    write_file_blob(
        f"{prefix}notes.txt",
        b"alpha beta gamma delta",
        {"content_type": "text/plain", "status": "uploaded"},
    )

    first = index_file("ws-rag-idem", "notes.txt")
    second = index_file("ws-rag-idem", "notes.txt")

    assert first.status == "indexed"
    assert second.status == "indexed"
    assert first.chunk_count == second.chunk_count == store.collection("ws-rag-idem").count()


def test_index_file_prefers_extracted_text_sidecar(tmp_path):
    _use_store(tmp_path)
    prefix = workspace_prefix("ws-rag-sidecar")
    write_file_blob(f"{prefix}report.pdf", b"%PDF-raw-binary", {"content_type": "application/pdf"})
    local_cache.write_file(
        f"{prefix}.extracted_text/report.pdf.txt",
        b"readable extracted report text",
        {"content_type": "text/plain"},
    )

    assert read_indexable_text("ws-rag-sidecar", "report.pdf") == "readable extracted report text"
    result = index_file("ws-rag-sidecar", "report.pdf")

    assert result.status == "indexed"
    assert result.chunk_count == 1


def test_index_file_deletes_chunks_when_text_disappears(tmp_path):
    store = _use_store(tmp_path)
    prefix = workspace_prefix("ws-rag-delete")
    write_file_blob(f"{prefix}notes.txt", b"index me", {"content_type": "text/plain"})
    assert index_file("ws-rag-delete", "notes.txt").chunk_count == 1

    local_cache.write_file(f"{prefix}notes.txt", b"%PDF-no-readable-text", {"content_type": "application/pdf"})
    result = index_file("ws-rag-delete", "notes.txt")

    assert result.status == "empty"
    assert store.collection("ws-rag-delete").count() == 0

