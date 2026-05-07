import pytest
from httpx import AsyncClient

import local_cache
from storage import workspace_prefix, workspace_meta_path, write_json_blob


def _seed_workspace(ws_id: str, name: str = "Test WS", status: str = "active"):
    """Helper to create a workspace directly in the local cache."""
    prefix = workspace_prefix(ws_id)
    local_cache.write_file(f"{prefix}.keep", b"")
    write_json_blob(workspace_meta_path(ws_id), {
        "id": ws_id,
        "name": name,
        "slug": ws_id,
        "status": status,
        "created_at": "2025-01-01T00:00:00+00:00",
        "updated_at": "2025-01-01T00:00:00+00:00",
        "file_count": 0,
        "folder_count": 0,
    })


class TestListWorkspaces:
    @pytest.mark.asyncio
    async def test_empty(self, client: AsyncClient):
        resp = await client.get("/api/workspaces")
        assert resp.status_code == 200
        assert resp.json()["workspaces"] == []

    @pytest.mark.asyncio
    async def test_returns_workspaces(self, client: AsyncClient):
        _seed_workspace("ws-1", "Alpha")
        _seed_workspace("ws-2", "Beta")
        resp = await client.get("/api/workspaces")
        assert resp.status_code == 200
        names = {w["name"] for w in resp.json()["workspaces"]}
        assert names == {"Alpha", "Beta"}


class TestCreateWorkspace:
    @pytest.mark.asyncio
    async def test_success(self, client: AsyncClient):
        resp = await client.post("/api/workspaces", json={"name": "My Workspace"})
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "My Workspace"
        assert data["status"] == "active"
        assert "id" in data

    @pytest.mark.asyncio
    async def test_slug_generation(self, client: AsyncClient):
        resp = await client.post("/api/workspaces", json={"name": "Hello World 123"})
        assert resp.status_code == 201
        assert resp.json()["slug"] == "hello-world-123"

    @pytest.mark.asyncio
    async def test_duplicate_name_409(self, client: AsyncClient):
        _seed_workspace("existing", "Existing WS")
        resp = await client.post("/api/workspaces", json={"name": "Existing WS"})
        assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_empty_name_422(self, client: AsyncClient):
        resp = await client.post("/api/workspaces", json={"name": ""})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_slug_collision_auto_suffix(self, client: AsyncClient):
        _seed_workspace("test", "Original")
        resp = await client.post("/api/workspaces", json={"name": "Test!"})
        assert resp.status_code == 201
        assert resp.json()["slug"] == "test-1"


class TestGetWorkspace:
    @pytest.mark.asyncio
    async def test_found(self, client: AsyncClient):
        _seed_workspace("ws-get", "Get Me")
        resp = await client.get("/api/workspaces/ws-get")
        assert resp.status_code == 200
        assert resp.json()["name"] == "Get Me"

    @pytest.mark.asyncio
    async def test_not_found(self, client: AsyncClient):
        resp = await client.get("/api/workspaces/nonexistent")
        assert resp.status_code == 404


class TestUpdateWorkspace:
    @pytest.mark.asyncio
    async def test_rename(self, client: AsyncClient):
        _seed_workspace("ws-upd", "Old Name")
        resp = await client.patch("/api/workspaces/ws-upd", json={"name": "New Name"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "New Name"

    @pytest.mark.asyncio
    async def test_update_status(self, client: AsyncClient):
        _seed_workspace("ws-st", "Status WS")
        resp = await client.patch("/api/workspaces/ws-st", json={"status": "completed"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "completed"

    @pytest.mark.asyncio
    async def test_invalid_status_400(self, client: AsyncClient):
        _seed_workspace("ws-bad", "Bad Status")
        resp = await client.patch("/api/workspaces/ws-bad", json={"status": "invalid"})
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_not_found(self, client: AsyncClient):
        resp = await client.patch("/api/workspaces/ghost", json={"name": "x"})
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_duplicate_name_409(self, client: AsyncClient):
        _seed_workspace("ws-a", "Alpha")
        _seed_workspace("ws-b", "Beta")
        resp = await client.patch("/api/workspaces/ws-b", json={"name": "Alpha"})
        assert resp.status_code == 409


class TestDeleteWorkspace:
    @pytest.mark.asyncio
    async def test_success(self, client: AsyncClient):
        _seed_workspace("ws-del", "Delete Me")
        resp = await client.delete("/api/workspaces/ws-del")
        assert resp.status_code == 200
        assert resp.json()["deleted"] == "ws-del"
        assert not local_cache.exists(workspace_prefix("ws-del").rstrip("/"))

    @pytest.mark.asyncio
    async def test_not_found(self, client: AsyncClient):
        resp = await client.delete("/api/workspaces/nope")
        assert resp.status_code == 404
