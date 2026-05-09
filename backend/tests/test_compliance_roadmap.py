"""Tests for compliance roadmap API."""

import pytest
from httpx import AsyncClient

import local_cache
from routers.auth import AUTH_SESSION_STORE
from storage import workspace_prefix, write_json_blob, workspace_meta_path


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _seed_ws(ws_id: str):
    prefix = workspace_prefix(ws_id)
    local_cache.write_file(f"{prefix}.keep", b"")
    write_json_blob(
        workspace_meta_path(ws_id),
        {
            "id": ws_id,
            "name": "T",
            "slug": ws_id,
            "status": "active",
            "created_at": "2025-01-01T00:00:00+00:00",
            "updated_at": "2025-01-01T00:00:00+00:00",
            "file_count": 0,
            "folder_count": 0,
        },
    )


@pytest.mark.asyncio
async def test_client_forbidden(client: AsyncClient):
    _seed_ws("ws-cr")
    AUTH_SESSION_STORE["cl-cr"] = {
        "email": "c@example.com",
        "name": "C",
        "picture": "",
        "role": "CLIENT",
    }
    resp = await client.get("/api/workspaces/ws-cr/compliance-roadmap", headers=_headers("cl-cr"))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_invariant_get_and_patch(client: AsyncClient):
    _seed_ws("ws-cr2")
    AUTH_SESSION_STORE["inv-cr"] = {
        "email": "inv@invariant-ai.com",
        "name": "I",
        "picture": "",
        "role": "INVARIANT",
    }
    empty = await client.get("/api/workspaces/ws-cr2/compliance-roadmap", headers=_headers("inv-cr"))
    assert empty.status_code == 200
    assert empty.json()["phases"] == []

    payload = {
        "phases": [
            {
                "name": "Discovery",
                "order": 0,
                "tasks": [
                    {
                        "title": "Kickoff",
                        "description": "",
                        "start": "2026-06-01",
                        "end": "2026-06-10",
                        "file_paths": ["docs/a.pdf"],
                        "links": ["https://example.com"],
                        "assignee_email": "founders@invariant-ai.com",
                    }
                ],
            }
        ]
    }
    saved = await client.patch(
        "/api/workspaces/ws-cr2/compliance-roadmap",
        headers=_headers("inv-cr"),
        json=payload,
    )
    assert saved.status_code == 200
    data = saved.json()
    assert len(data["phases"]) == 1
    assert data["phases"][0]["name"] == "Discovery"
    assert data["phases"][0]["tasks"][0]["title"] == "Kickoff"
    assert data["phases"][0]["tasks"][0]["file_paths"] == ["docs/a.pdf"]
    assert data["phases"][0]["tasks"][0]["assignee_email"] == "founders@invariant-ai.com"
    assert data.get("updated_at")

    again = await client.get("/api/workspaces/ws-cr2/compliance-roadmap", headers=_headers("inv-cr"))
    assert again.status_code == 200
    assert len(again.json()["phases"]) == 1
