import pytest
from unittest.mock import patch, MagicMock
from httpx import AsyncClient

import local_cache
from storage import workspace_prefix, workspace_meta_path, write_json_blob, write_file_blob


def _seed_workspace(ws_id: str, name: str = "Test WS"):
    prefix = workspace_prefix(ws_id)
    local_cache.write_file(f"{prefix}.keep", b"")
    write_json_blob(workspace_meta_path(ws_id), {
        "id": ws_id, "name": name, "slug": ws_id,
        "status": "active", "created_at": "2025-01-01T00:00:00+00:00",
        "updated_at": "2025-01-01T00:00:00+00:00",
        "file_count": 0, "folder_count": 0,
    })


class TestSearchEndpoint:
    @pytest.mark.asyncio
    async def test_workspace_not_found(self, client: AsyncClient):
        resp = await client.post("/api/search", json={
            "workspace_id": "nonexistent",
            "query": "find something",
            "session_id": "s1",
        })
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_missing_fields_422(self, client: AsyncClient):
        resp = await client.post("/api/search", json={"workspace_id": "ws"})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_success_with_mock(self, client: AsyncClient):
        _seed_workspace("ws-search", "Search WS")

        mock_result = {
            "interaction_id": "test-id",
            "results": [{"path": "/doc.txt", "name": "doc.txt", "score": 0.9, "relevance": "match"}],
            "message": "Found 1 relevant document(s).",
            "summary": "Test summary",
        }
        with patch("routers.search.search_documents", return_value=mock_result):
            resp = await client.post("/api/search", json={
                "workspace_id": "ws-search",
                "query": "test query",
                "session_id": "sess-1",
            })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["results"]) == 1
        assert data["summary"] == "Test summary"
