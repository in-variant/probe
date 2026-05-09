"""Workspace-scoped document requests (INVARIANT raises, CLIENT fulfills via upload)."""

from __future__ import annotations

import re
import uuid
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from rag.jobs import enqueue_index
from routers.auth import get_current_user
from storage import now_iso, read_json_blob, workspace_prefix, write_file_blob, write_json_blob

router = APIRouter(tags=["document-requests"])

REQUESTS_FILE = ".requests/requests.json"


def _requests_blob_path(workspace_id: str) -> str:
    return f"{workspace_prefix(workspace_id)}{REQUESTS_FILE}"


def _read_requests(workspace_id: str) -> list[dict[str, Any]]:
    data = read_json_blob(_requests_blob_path(workspace_id))
    if not data:
        return []
    items = data.get("requests")
    return list(items) if isinstance(items, list) else []


def _write_requests(workspace_id: str, requests: list[dict[str, Any]]) -> None:
    write_json_blob(
        _requests_blob_path(workspace_id),
        {"requests": requests, "updated_at": now_iso()},
    )


def _require_invariant_or_admin(request: Request) -> dict[str, Any]:
    session = get_current_user(request)
    role = str(session.get("role", "")).upper()
    if role not in ("INVARIANT", "ADMIN"):
        raise HTTPException(403, "Only Invariant users can create document requests")
    return session


def _require_client_or_admin(request: Request) -> dict[str, Any]:
    session = get_current_user(request)
    role = str(session.get("role", "")).upper()
    if role not in ("CLIENT", "ADMIN"):
        raise HTTPException(403, "Only client users can fulfill document requests")
    return session


def _sanitize_relative_path(path: str | None) -> str:
    if not path or not str(path).strip():
        return ""
    clean = str(path).strip().replace("\\", "/").lstrip("/")
    if ".." in clean or clean.startswith("."):
        raise HTTPException(422, "Invalid path")
    return clean


class DocumentRequestCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    body: str = Field(default="", max_length=8000)
    desired_path: str | None = Field(default=None, max_length=1024)


class DocumentRequestOut(BaseModel):
    id: str
    created_by_email: str
    created_by_name: str
    created_at: str
    title: str
    body: str
    desired_path: str
    status: str
    fulfilled_by_email: str | None = None
    fulfilled_at: str | None = None
    stored_path: str | None = None
    updated_at: str | None = None

    model_config = {"extra": "ignore"}


@router.get("/workspaces/{workspace_id}/document-requests", response_model=list[DocumentRequestOut])
async def list_document_requests(workspace_id: str, request: Request):
    get_current_user(request)
    from routers.documents import _ensure_workspace

    _ensure_workspace(workspace_id)
    raw = _read_requests(workspace_id)
    return [DocumentRequestOut(**item) for item in raw if isinstance(item, dict)]


@router.post("/workspaces/{workspace_id}/document-requests", response_model=DocumentRequestOut, status_code=201)
async def create_document_request(workspace_id: str, body: DocumentRequestCreate, request: Request):
    _require_invariant_or_admin(request)
    from routers.documents import _ensure_workspace

    _ensure_workspace(workspace_id)
    desired = _sanitize_relative_path(body.desired_path) if body.desired_path else ""
    session = get_current_user(request)
    ts = now_iso()
    rec = {
        "id": str(uuid.uuid4()),
        "created_by_email": str(session.get("email", "")),
        "created_by_name": str(session.get("name", "")),
        "created_at": ts,
        "title": body.title.strip(),
        "body": body.body.strip(),
        "desired_path": desired,
        "status": "open",
        "fulfilled_by_email": None,
        "fulfilled_at": None,
        "stored_path": None,
    }
    items = _read_requests(workspace_id)
    items.append(rec)
    _write_requests(workspace_id, items)
    return DocumentRequestOut(**rec)


@router.patch("/workspaces/{workspace_id}/document-requests/{request_id}")
async def cancel_document_request(workspace_id: str, request_id: str, request: Request):
    session = get_current_user(request)
    from routers.documents import _ensure_workspace

    _ensure_workspace(workspace_id)
    items = _read_requests(workspace_id)
    role = str(session.get("role", "")).upper()
    email = str(session.get("email", "")).lower()
    found = False
    for item in items:
        if not isinstance(item, dict) or item.get("id") != request_id:
            continue
        if item.get("status") != "open":
            raise HTTPException(409, "Request is not open")
        if role != "ADMIN" and str(item.get("created_by_email", "")).lower() != email:
            raise HTTPException(403, "Not allowed to cancel this request")
        item["status"] = "cancelled"
        item["updated_at"] = now_iso()
        found = True
        break
    if not found:
        raise HTTPException(404, "Request not found")
    _write_requests(workspace_id, items)
    return {"ok": True}


@router.post("/workspaces/{workspace_id}/document-requests/{request_id}/fulfill")
async def fulfill_document_request(
    workspace_id: str,
    request_id: str,
    request: Request,
    file: UploadFile = File(...),
):
    _require_client_or_admin(request)
    from routers.documents import _ensure_workspace, _file_local_path, _update_workspace_counts

    _ensure_workspace(workspace_id)
    session = get_current_user(request)
    items = _read_requests(workspace_id)
    target: dict[str, Any] | None = None
    for item in items:
        if isinstance(item, dict) and item.get("id") == request_id:
            target = item
            break
    if not target:
        raise HTTPException(404, "Request not found")
    if target.get("status") != "open":
        raise HTTPException(409, "Request is not open")

    raw = await file.read()
    filename = file.filename or "upload.bin"
    filename = re.sub(r"[^\w.\-()+@\[\] ]+", "_", filename).strip() or "upload.bin"

    desired = str(target.get("desired_path") or "").strip()
    if desired:
        if desired.endswith("/"):
            rel_path = f"{desired.rstrip('/')}/{filename}".lstrip("/")
        else:
            p_desired = desired.split("/")
            if len(p_desired) > 1 and "." not in p_desired[-1]:
                rel_path = f"{desired}/{filename}".lstrip("/")
            else:
                rel_path = desired.lstrip("/")
    else:
        rel_path = f"uploads/requests/{request_id}/{filename}"

    parts = rel_path.strip("/").split("/")
    base_name = parts[-1]
    parent = "/" + "/".join(parts[:-1]) if len(parts) > 1 else "/"
    file_path = _file_local_path(workspace_id, parent, base_name)

    content_type = file.content_type or "application/octet-stream"
    metadata = {
        "status": "uploaded",
        "original_name": filename,
        "content_type": content_type,
        "size": len(raw),
        "time_created": now_iso(),
        "updated": now_iso(),
        "source": "document_request",
        "document_request_id": request_id,
    }
    write_file_blob(file_path, raw, metadata)
    enqueue_index(workspace_id, rel_path)

    target["status"] = "fulfilled"
    target["fulfilled_by_email"] = str(session.get("email", ""))
    target["fulfilled_at"] = now_iso()
    target["stored_path"] = rel_path
    _write_requests(workspace_id, items)
    await file.close()
    _update_workspace_counts(workspace_id)
    return {"stored_path": rel_path, "request": DocumentRequestOut(**target)}
