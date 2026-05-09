from pathlib import Path
from unittest.mock import MagicMock, patch

import local_cache
from ai_harness import search_documents
from rag.chroma_store import ChromaStore, set_store_for_tests
from rag.indexer import index_file
from rag.jobs import IndexJobQueue, bootstrap_all_workspaces
from rag.retriever import retrieve
from storage import workspace_meta_path, workspace_prefix, write_file_blob, write_json_blob


def _use_store(tmp_path: Path) -> None:
    set_store_for_tests(ChromaStore(tmp_path / "chroma"))


def _seed_workspace(ws_id: str):
    prefix = workspace_prefix(ws_id)
    local_cache.write_file(f"{prefix}.keep", b"")
    write_json_blob(workspace_meta_path(ws_id), {
        "id": ws_id,
        "name": ws_id,
        "slug": ws_id,
        "status": "active",
        "created_at": "2025-01-01T00:00:00+00:00",
        "updated_at": "2025-01-01T00:00:00+00:00",
    })


def test_retrieve_returns_indexed_chunks(tmp_path):
    _use_store(tmp_path)
    _seed_workspace("ws-rag-ret")
    write_file_blob(
        f"{workspace_prefix('ws-rag-ret')}guide.txt",
        b"chroma retrieval finds the source document",
        {"content_type": "text/plain"},
    )
    index_file("ws-rag-ret", "guide.txt")

    hits = retrieve("ws-rag-ret", "source document", top_k=3)

    assert hits
    assert hits[0].path == "/guide.txt"


def test_queue_dedupes_pending_jobs():
    queue = IndexJobQueue(workers=0)

    assert queue.enqueue("ws", "a.txt") is True
    assert queue.enqueue("ws", "a.txt") is False
    assert queue.queue.qsize() == 1


async def test_bootstrap_enqueues_workspace_files(monkeypatch):
    _seed_workspace("ws-rag-boot")
    write_file_blob(f"{workspace_prefix('ws-rag-boot')}boot.txt", b"boot", {"content_type": "text/plain"})
    seen: list[tuple[str, str]] = []

    monkeypatch.setattr("rag.jobs.index_queue.enqueue", lambda workspace_id, path, op="index": seen.append((workspace_id, path)) or True)
    count = await bootstrap_all_workspaces()

    assert count == 1
    assert seen == [("ws-rag-boot", "boot.txt")]


def test_search_documents_uses_rag_and_sources(tmp_path):
    _use_store(tmp_path)
    _seed_workspace("ws-rag-search")
    write_file_blob(
        f"{workspace_prefix('ws-rag-search')}policy.txt",
        b"The refund policy allows returns within 30 days.",
        {"content_type": "text/plain", "status": "uploaded", "size": 48},
    )
    index_file("ws-rag-search", "policy.txt")

    completion = MagicMock()
    completion.choices = [MagicMock()]
    completion.choices[0].message.content = "Returns are allowed within **30 days**."
    client = MagicMock()
    client.chat.completions.create.return_value = completion

    with patch("ai_harness._get_openai_client", return_value=client), patch("ai_harness._log_interaction"):
        result = search_documents("ws-rag-search", "what is the refund policy?", "sess")

    assert result["results"][0]["path"] == "/policy.txt"
    assert "Source: policy.txt" in result["summary"]

