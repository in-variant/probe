"""Tests for workspace document requests API."""

import pytest
from httpx import AsyncClient
from unittest.mock import patch

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
async def test_invariant_creates_request(client: AsyncClient):
    _seed_ws("ws-req")
    AUTH_SESSION_STORE["inv-token"] = {
        "email": "inv@invariant-ai.com",
        "name": "Inv",
        "picture": "",
        "role": "INVARIANT",
    }
    resp = await client.post(
        "/api/workspaces/ws-req/document-requests",
        headers=_headers("inv-token"),
        json={"title": "Need CDR", "body": "Please upload", "desired_path": "docs/"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Need CDR"
    assert data["status"] == "open"
    assert data["desired_path"] == "docs/"


@pytest.mark.asyncio
async def test_client_cannot_create_request(client: AsyncClient):
    _seed_ws("ws-req2")
    AUTH_SESSION_STORE["cli-token"] = {
        "email": "cli@example.com",
        "name": "Cli",
        "picture": "",
        "role": "CLIENT",
    }
    resp = await client.post(
        "/api/workspaces/ws-req2/document-requests",
        headers=_headers("cli-token"),
        json={"title": "X"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_client_fulfills_request(client: AsyncClient):
    _seed_ws("ws-req3")
    AUTH_SESSION_STORE["inv2"] = {
        "email": "inv2@invariant-ai.com",
        "name": "Inv",
        "picture": "",
        "role": "INVARIANT",
    }
    AUTH_SESSION_STORE["cli2"] = {
        "email": "cli2@example.com",
        "name": "Cli",
        "picture": "",
        "role": "CLIENT",
    }
    create = await client.post(
        "/api/workspaces/ws-req3/document-requests",
        headers=_headers("inv2"),
        json={"title": "Upload spec", "body": "", "desired_path": ""},
    )
    rid = create.json()["id"]
    with patch("routers.document_requests.enqueue_index"):
        resp = await client.post(
            f"/api/workspaces/ws-req3/document-requests/{rid}/fulfill",
            headers=_headers("cli2"),
            files={"file": ("answer.txt", b"payload", "text/plain")},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert "uploads/requests/" in body["stored_path"]
    assert body["request"]["status"] == "fulfilled"
    prefix = workspace_prefix("ws-req3")
    assert local_cache.read_file(f"{prefix}{body['stored_path']}") == b"payload"


@pytest.mark.asyncio
async def test_invariant_cannot_fulfill(client: AsyncClient):
    _seed_ws("ws-req4")
    AUTH_SESSION_STORE["inv3"] = {
        "email": "inv3@invariant-ai.com",
        "name": "Inv",
        "picture": "",
        "role": "INVARIANT",
    }
    create = await client.post(
        "/api/workspaces/ws-req4/document-requests",
        headers=_headers("inv3"),
        json={"title": "R"},
    )
    rid = create.json()["id"]
    resp = await client.post(
        f"/api/workspaces/ws-req4/document-requests/{rid}/fulfill",
        headers=_headers("inv3"),
        files={"file": ("a.txt", b"x", "text/plain")},
    )
    assert resp.status_code == 403
