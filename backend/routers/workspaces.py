import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import local_cache
from storage import (
    workspace_prefix,
    workspace_meta_path,
    read_json_blob,
    write_json_blob,
    delete_prefix,
    rename_prefix,
    now_iso,
    WORKSPACE_ROOT,
)

router = APIRouter(tags=["workspaces"])


class WorkspaceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    status: str = Field(default="active")


class WorkspaceUpdate(BaseModel):
    name: str | None = None
    status: str | None = None


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "workspace"


def _list_workspace_ids() -> list[str]:
    """List workspace IDs by scanning local cache directories."""
    dirs, _ = local_cache.list_dir(WORKSPACE_ROOT)
    return sorted(dirs)


def _existing_workspace_names() -> dict[str, str]:
    """Return a mapping of lowercased workspace name -> workspace id."""
    names: dict[str, str] = {}
    for ws_id in _list_workspace_ids():
        meta = read_json_blob(workspace_meta_path(ws_id))
        if meta and "name" in meta:
            names[meta["name"].strip().lower()] = ws_id
    return names


@router.get("/workspaces")
async def list_workspaces():
    ws_ids = _list_workspace_ids()
    workspaces = []
    for ws_id in ws_ids:
        meta = read_json_blob(workspace_meta_path(ws_id))
        if meta:
            meta["id"] = ws_id
            workspaces.append(meta)
    return {"workspaces": workspaces}


@router.post("/workspaces", status_code=201)
async def create_workspace(body: WorkspaceCreate):
    if body.name.strip().lower() in _existing_workspace_names():
        raise HTTPException(409, "A workspace with this name already exists")

    slug = slugify(body.name)

    existing_ids = _list_workspace_ids()
    final_slug = slug
    counter = 1
    while final_slug in existing_ids:
        final_slug = f"{slug}-{counter}"
        counter += 1

    placeholder_path = f"{workspace_prefix(final_slug)}.keep"
    local_cache.write_file(placeholder_path, b"")
    from sync import sync_engine, SyncOp, OpType
    sync_engine.enqueue(SyncOp(op=OpType.WRITE_FILE, path=placeholder_path, data=b"", metadata={"content_type": "application/octet-stream"}))

    ts = now_iso()
    meta = {
        "id": final_slug,
        "name": body.name,
        "slug": final_slug,
        "status": body.status,
        "created_at": ts,
        "updated_at": ts,
        "file_count": 0,
        "folder_count": 0,
    }
    write_json_blob(workspace_meta_path(final_slug), meta)
    return meta


@router.get("/workspaces/{workspace_id}")
async def get_workspace(workspace_id: str):
    meta = read_json_blob(workspace_meta_path(workspace_id))
    if not meta:
        raise HTTPException(404, "Workspace not found")
    meta["id"] = workspace_id
    return meta


@router.patch("/workspaces/{workspace_id}")
async def update_workspace(workspace_id: str, body: WorkspaceUpdate):
    meta = read_json_blob(workspace_meta_path(workspace_id))
    if not meta:
        raise HTTPException(404, "Workspace not found")

    if body.name is not None:
        existing = _existing_workspace_names()
        name_key = body.name.strip().lower()
        owner = existing.get(name_key)
        if owner is not None and owner != workspace_id:
            raise HTTPException(409, "A workspace with this name already exists")
        meta["name"] = body.name
    if body.status is not None:
        if body.status not in ("active", "on-hold", "completed"):
            raise HTTPException(400, "Invalid status")
        meta["status"] = body.status
    meta["updated_at"] = now_iso()
    write_json_blob(workspace_meta_path(workspace_id), meta)
    meta["id"] = workspace_id
    return meta


@router.delete("/workspaces/{workspace_id}")
async def delete_workspace(workspace_id: str):
    prefix = workspace_prefix(workspace_id)
    if not local_cache.exists(prefix.rstrip("/")):
        raise HTTPException(404, "Workspace not found")
    delete_prefix(prefix.rstrip("/"))
    return {"deleted": workspace_id}
