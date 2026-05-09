"""Tests for admin-only Chroma / RAG maintenance endpoints."""

from unittest.mock import patch

import pytest
from httpx import AsyncClient

from rag.chroma_store import get_store, reset_store_singleton
from rag.types import RagChunk
from routers import admin_rag
from routers.auth import ADMIN_EMAIL, AUTH_SESSION_STORE


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _clear_sessions():
    AUTH_SESSION_STORE.clear()
    yield
    AUTH_SESSION_STORE.clear()


@pytest.mark.asyncio
async def test_reindex_requires_auth(client: AsyncClient):
    resp = await client.post("/api/admin/rag/reindex-workspace", json={"workspace_id": "w1"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_reindex_forbidden_for_non_admin(client: AsyncClient):
    AUTH_SESSION_STORE["cli"] = {
        "email": "client@example.com",
        "name": "C",
        "picture": "",
        "role": "CLIENT",
    }
    resp = await client.post(
        "/api/admin/rag/reindex-workspace",
        json={"workspace_id": "w1"},
        headers=_headers("cli"),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_reindex_admin_ok(client: AsyncClient):
    AUTH_SESSION_STORE["adm"] = {
        "email": ADMIN_EMAIL,
        "name": "A",
        "picture": "",
        "role": "ADMIN",
    }
    with patch("routers.admin_rag.index_queue.enqueue_workspace", return_value=5) as m:
        resp = await client.post(
            "/api/admin/rag/reindex-workspace",
            json={"workspace_id": "space-1"},
            headers=_headers("adm"),
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["workspace_id"] == "space-1"
    assert body["enqueued"] == 5
    m.assert_called_once_with("space-1")


@pytest.mark.asyncio
async def test_wipe_requires_phrase(client: AsyncClient):
    AUTH_SESSION_STORE["adm2"] = {
        "email": ADMIN_EMAIL,
        "name": "A",
        "picture": "",
        "role": "ADMIN",
    }
    resp = await client.post(
        "/api/admin/rag/wipe-chroma",
        json={"confirmation": "wrong"},
        headers=_headers("adm2"),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_wipe_admin_clears_collections(client: AsyncClient):
    reset_store_singleton()
    store = get_store()
    chunk = RagChunk(
        workspace_id="w1",
        path="notes/a.md",
        chunk_id="c1",
        content_hash="h1",
        chunk_index=0,
        text="hello",
        metadata={"workspace_id": "w1", "path": "notes/a.md", "chunk_index": 0},
    )
    store.upsert_chunks("w1", [chunk], [[0.01] * 8])
    assert store.chunk_count("w1") == 1

    AUTH_SESSION_STORE["adm3"] = {
        "email": ADMIN_EMAIL,
        "name": "A",
        "picture": "",
        "role": "ADMIN",
    }
    resp = await client.post(
        "/api/admin/rag/wipe-chroma",
        json={"confirmation": admin_rag.WIPE_CONFIRMATION_PHRASE},
        headers=_headers("adm3"),
    )
    assert resp.status_code == 200
    assert resp.json()["deleted_collections"] >= 1

    reset_store_singleton()
    store2 = get_store()
    assert store2.chunk_count("w1") == 0


def test_wipe_phrase_matches_frontend_contract():
    assert admin_rag.WIPE_CONFIRMATION_PHRASE == "DELETE CHROMA"


@pytest.mark.asyncio
async def test_diagnostics_requires_admin(client: AsyncClient):
    AUTH_SESSION_STORE["viewer"] = {
        "email": "viewer@example.com",
        "name": "V",
        "picture": "",
        "role": "CLIENT",
    }
    resp = await client.get("/api/admin/rag/diagnostics?workspace_id=w1", headers=_headers("viewer"))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_diagnostics_payload_shape(client: AsyncClient):
    AUTH_SESSION_STORE["adm4"] = {
        "email": ADMIN_EMAIL,
        "name": "A",
        "picture": "",
        "role": "ADMIN",
    }
    resp = await client.get("/api/admin/rag/diagnostics?workspace_id=w1", headers=_headers("adm4"))
    assert resp.status_code == 200
    body = resp.json()
    assert "knowledge_base" in body
    assert "collections" in body
    assert "storage" in body
