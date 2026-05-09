import json
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

import local_cache
from storage import workspace_prefix, workspace_meta_path, write_json_blob, write_file_blob
from ai_harness import (
    _strip_markdown_fences,
    _collect_documents,
    _build_user_prompt,
    _read_file_text,
    _generate_summary,
    _hit_trace,
    _log_interaction,
    search_documents,
)
from rag.types import RagHit


def _seed_workspace(ws_id: str, name: str = "Test"):
    prefix = workspace_prefix(ws_id)
    local_cache.write_file(f"{prefix}.keep", b"")
    write_json_blob(workspace_meta_path(ws_id), {
        "id": ws_id, "name": name, "slug": ws_id,
        "status": "active", "created_at": "2025-01-01T00:00:00+00:00",
        "updated_at": "2025-01-01T00:00:00+00:00",
        "file_count": 0, "folder_count": 0,
    })


def _seed_file(ws_id: str, path: str, content: bytes = b"hello"):
    prefix = workspace_prefix(ws_id)
    file_path = f"{prefix}{path.lstrip('/')}"
    write_file_blob(file_path, content, {
        "status": "uploaded",
        "original_name": path.split("/")[-1],
        "content_type": "text/plain",
        "size": len(content),
    })


class TestStripMarkdownFences:
    def test_strips_json_fence(self):
        text = '```json\n[{"path": "/a.txt"}]\n```'
        assert _strip_markdown_fences(text) == '[{"path": "/a.txt"}]'

    def test_strips_bare_fence(self):
        text = '```\nhello\n```'
        assert _strip_markdown_fences(text) == "hello"

    def test_no_fences_returns_as_is(self):
        text = '[{"path": "/a.txt"}]'
        assert _strip_markdown_fences(text) == text

    def test_partial_fence_returns_as_is(self):
        text = '```json\nincomplete'
        assert _strip_markdown_fences(text) == text


class TestCollectDocuments:
    def test_empty_workspace(self):
        _seed_workspace("ws-empty")
        docs = _collect_documents("ws-empty")
        assert docs == []

    def test_collects_files(self):
        _seed_workspace("ws-coll")
        _seed_file("ws-coll", "report.pdf", b"pdf-data")
        _seed_file("ws-coll", "notes.txt", b"notes")
        docs = _collect_documents("ws-coll")
        names = {d["name"] for d in docs}
        assert "report.pdf" in names
        assert "notes.txt" in names

    def test_skips_hidden_files(self):
        _seed_workspace("ws-hid")
        prefix = workspace_prefix("ws-hid")
        local_cache.write_file(f"{prefix}.hidden", b"secret")
        local_cache.write_file(f"{prefix}visible.txt", b"ok")
        docs = _collect_documents("ws-hid")
        names = {d["name"] for d in docs}
        assert ".hidden" not in names
        assert "visible.txt" in names

    def test_recursive(self):
        _seed_workspace("ws-rec")
        _seed_file("ws-rec", "sub/deep.txt", b"deep")
        docs = _collect_documents("ws-rec")
        assert any(d["name"] == "deep.txt" for d in docs)


class TestBuildUserPrompt:
    def test_includes_query_and_docs(self):
        docs = [
            {"path": "/a.txt", "name": "a.txt", "original_name": "a.txt",
             "content_type": "text/plain", "size": 10, "status": "uploaded"},
        ]
        prompt = _build_user_prompt("find a", docs)
        assert "find a" in prompt
        assert "a.txt" in prompt


class TestReadFileText:
    def test_reads_text(self):
        _seed_workspace("ws-rft")
        _seed_file("ws-rft", "data.txt", b"hello world")
        text = _read_file_text("ws-rft", "/data.txt")
        assert text == "hello world"

    def test_missing_returns_none(self):
        _seed_workspace("ws-rftm")
        assert _read_file_text("ws-rftm", "/nope.txt") is None

    def test_truncates_large_files(self):
        _seed_workspace("ws-rftl")
        _seed_file("ws-rftl", "big.txt", b"x" * 100_000)
        text = _read_file_text("ws-rftl", "/big.txt")
        assert len(text) <= 30_000


class TestGenerateSummary:
    def test_empty_results_returns_empty(self):
        assert _generate_summary("query", [], "ws") == ""

    def test_calls_openai(self):
        _seed_workspace("ws-gs")
        _seed_file("ws-gs", "doc.txt", b"important content")

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.content = "Summary text"

        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_completion

        with patch("ai_harness._get_openai_client", return_value=mock_client):
            result = _generate_summary(
                "what is important?",
                [{"path": "/doc.txt", "name": "doc.txt"}],
                "ws-gs",
            )
        assert result == "Summary text"


class TestSearchDocuments:
    def test_empty_workspace_returns_no_docs(self):
        _seed_workspace("ws-se")
        with patch("ai_harness._log_interaction", return_value={}):
            result = search_documents("ws-se", "query", "sess")
        assert result["results"] == []
        assert "No documents" in result["message"]

    def test_successful_search(self):
        _seed_workspace("ws-ss")
        _seed_file("ws-ss", "file.txt", b"data")

        ai_response = json.dumps([
            {"path": "/file.txt", "name": "file.txt", "relevance": "match", "score": 0.95},
        ])

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.content = ai_response

        summary_completion = MagicMock()
        summary_completion.choices = [MagicMock()]
        summary_completion.choices[0].message.content = "Brief summary"

        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = [mock_completion, summary_completion]

        with patch("ai_harness._get_openai_client", return_value=mock_client), \
             patch("ai_harness._log_interaction", return_value={}):
            result = search_documents("ws-ss", "find file", "sess")

        assert len(result["results"]) == 1
        assert result["results"][0]["score"] == 0.95
        assert result["summary"] == "Brief summary"

    def test_openai_returns_invalid_json(self):
        _seed_workspace("ws-ij")
        _seed_file("ws-ij", "f.txt", b"x")

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.content = "not json at all"

        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_completion

        with patch("ai_harness._get_openai_client", return_value=mock_client), \
             patch("ai_harness._log_interaction", return_value={}):
            result = search_documents("ws-ij", "query", "sess")

        assert result["results"] == []
        assert "unparseable" in result["message"].lower()

    def test_openai_api_error(self):
        _seed_workspace("ws-err")
        _seed_file("ws-err", "f.txt", b"x")

        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = RuntimeError("API down")

        with patch("ai_harness._get_openai_client", return_value=mock_client), \
             patch("ai_harness._log_interaction", return_value={}):
            result = search_documents("ws-err", "query", "sess")

        assert result["results"] == []
        assert "failed" in result["message"].lower()

    def test_research_rag_uses_subquery_pipeline_when_available(self):
        _seed_workspace("ws-rdp")
        _seed_file("ws-rdp", "a.txt", b"data")
        hit = RagHit(
            workspace_id="ws-rdp",
            path="/a.txt",
            chunk_id="c1",
            chunk_index=0,
            text="excerpt",
            score=0.9,
            metadata={},
        )
        deep_summary = "## SubQ\n\nSection body\n\nSources:\nSource: a.txt"
        with patch("ai_harness.retrieve", return_value=[hit]), \
             patch("ai_harness._research_deep_pipeline", return_value=(deep_summary, [hit])), \
             patch("ai_harness._log_interaction", return_value={}):
            result = search_documents(
                "ws-rdp",
                "What is the policy?\n\nAgent mode: Research\n\nReturn a clean markdown answer.",
                "sess-rdp",
            )
        assert "## SubQ" in result["summary"]
        assert len(result["results"]) >= 1

    def test_hit_trace_reads_content_hash_from_metadata(self):
        hit = RagHit(
            workspace_id="ws",
            path="/doc.txt",
            chunk_id="chunk-1",
            chunk_index=0,
            text="trace preview",
            score=0.987654321,
            metadata={"content_hash": "hash-1"},
        )
        trace = _hit_trace(hit)
        assert trace["content_hash"] == "hash-1"
        assert trace["score"] == 0.987654

    def test_hit_trace_tolerates_missing_content_hash(self):
        hit = RagHit(
            workspace_id="ws",
            path="/doc.txt",
            chunk_id="chunk-1",
            chunk_index=0,
            text="trace preview",
            score=0.9,
            metadata={},
        )
        trace = _hit_trace(hit)
        assert "content_hash" not in trace

    def test_log_interaction_writes_workspace_chat_and_trace(self):
        _seed_workspace("ws-log", "Log WS")
        paths = _log_interaction(
            "ws-log",
            "interaction-1",
            "session-1",
            "2025-01-01T00:00:00+00:00",
            {
                "interaction_id": "interaction-1",
                "session_id": "session-1",
                "workspace_id": "ws-log",
                "query": "Create a useful summary report",
                "document_count": 1,
            },
            {
                "message": "Found 1 relevant document(s).",
                "summary": "Summary text",
                "results": [{"path": "/doc.txt", "score": 0.9}],
            },
            {"retrieval": {"mode": "rag", "hits": [{"chunk_id": "c1", "preview": "short snippet"}]}},
        )

        assert paths["chat_path"].startswith(workspace_prefix("ws-log") + ".chats/create-a-useful-summary-report-session-1")
        assert paths["trace_path"] == workspace_prefix("ws-log") + ".traces/interaction-1.json"

        chat = local_cache.read_json(paths["chat_path"])
        trace = local_cache.read_json(paths["trace_path"])
        assert chat["session_id"] == "session-1"
        assert chat["turns"][0]["user"] == "Create a useful summary report"
        assert trace["trace"]["retrieval"]["mode"] == "rag"

    def test_log_interaction_appends_to_existing_chat(self):
        _seed_workspace("ws-log-append", "Log Append WS")
        first = _log_interaction(
            "ws-log-append",
            "interaction-1",
            "session-append",
            "2025-01-01T00:00:00+00:00",
            {"interaction_id": "interaction-1", "session_id": "session-append", "query": "First prompt"},
            {"message": "ok", "summary": "one", "results": []},
        )
        second = _log_interaction(
            "ws-log-append",
            "interaction-2",
            "session-append",
            "2025-01-01T00:00:01+00:00",
            {"interaction_id": "interaction-2", "session_id": "session-append", "query": "Second prompt"},
            {"message": "ok", "summary": "two", "results": []},
        )

        assert first["chat_path"] == second["chat_path"]
        chat = local_cache.read_json(first["chat_path"])
        assert [turn["user"] for turn in chat["turns"]] == ["First prompt", "Second prompt"]
