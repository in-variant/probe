import json
import mimetypes
from datetime import timedelta
from pathlib import PurePosixPath
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query
from pydantic import BaseModel, Field

import local_cache
from storage import (
    get_bucket,
    workspace_prefix,
    workspace_meta_path,
    read_json_blob,
    write_json_blob,
    write_file_blob,
    delete_blob,
    delete_prefix,
    rename_prefix,
    rename_blob,
    blob_exists,
    now_iso,
)

router = APIRouter(tags=["documents"])

FOLDER_META = ".folder-meta.json"


def _resolve_local_path(workspace_id: str, relative_path: str) -> str:
    """Build the local prefix for a folder inside a workspace."""
    base = workspace_prefix(workspace_id)
    if relative_path and relative_path != "/":
        clean = relative_path.strip("/")
        return f"{base}{clean}/"
    return base


def _file_local_path(workspace_id: str, relative_path: str, filename: str) -> str:
    base = workspace_prefix(workspace_id)
    if relative_path and relative_path != "/":
        clean = relative_path.strip("/")
        return f"{base}{clean}/{filename}"
    return f"{base}{filename}"


def _ensure_workspace(workspace_id: str):
    meta = read_json_blob(workspace_meta_path(workspace_id))
    if not meta:
        raise HTTPException(404, "Workspace not found")
    return meta


def _update_workspace_counts(workspace_id: str):
    """Count files and folders by scanning local filesystem (instant)."""
    prefix = workspace_prefix(workspace_id)
    all_files = local_cache.list_all_files(prefix.rstrip("/"))

    file_count = 0
    folder_count = 0
    seen_folders: set[str] = set()

    for f in all_files:
        rel = f[len(prefix):]
        if not rel or rel.startswith("."):
            continue
        parts = rel.split("/")
        if len(parts) > 1:
            folder_name = parts[0]
            if folder_name not in seen_folders:
                seen_folders.add(folder_name)
                folder_count += 1
        name = parts[-1]
        if name and not name.startswith("."):
            file_count += 1

    ws_meta = read_json_blob(workspace_meta_path(workspace_id)) or {}
    ws_meta["file_count"] = file_count
    ws_meta["folder_count"] = folder_count
    ws_meta["updated_at"] = now_iso()
    write_json_blob(workspace_meta_path(workspace_id), ws_meta)


# ── List contents of a folder ──────────────────────────────────────


@router.get("/workspaces/{workspace_id}/documents")
async def list_documents(
    workspace_id: str,
    path: str = Query(default="/", description="Folder path relative to workspace root"),
):
    _ensure_workspace(workspace_id)
    local_prefix = _resolve_local_path(workspace_id, path)

    dirs, files_in_dir = local_cache.list_dir(local_prefix.rstrip("/"))

    folders = []
    for folder_name in dirs:
        if folder_name.startswith("."):
            continue
        meta_path = f"{local_prefix}{folder_name}/{FOLDER_META}"
        folder_meta = local_cache.read_json(meta_path) or {}
        folders.append({
            "name": folder_name,
            "type": "folder",
            "path": f"{path.rstrip('/')}/{folder_name}".lstrip("/"),
            "created_at": folder_meta.get("created_at"),
            "updated_at": folder_meta.get("updated_at"),
        })

    files = []
    for fname in files_in_dir:
        if not fname or fname.startswith("."):
            continue
        file_rel_path = f"{local_prefix}{fname}"
        ext = PurePosixPath(fname).suffix.lstrip(".").lower()
        metadata = local_cache.read_metadata(file_rel_path)
        size = local_cache.get_file_size(file_rel_path)

        files.append({
            "name": fname,
            "type": "file",
            "path": f"{path.rstrip('/')}/{fname}".lstrip("/"),
            "size": size,
            "content_type": metadata.get("content_type", mimetypes.guess_type(fname)[0] or "application/octet-stream"),
            "extension": ext,
            "created_at": metadata.get("time_created"),
            "updated_at": metadata.get("updated"),
            "status": metadata.get("status", "uploaded"),
        })

    return {"folders": folders, "files": files, "current_path": path}


# ── Create folder ──────────────────────────────────────────────────


class FolderCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


@router.post("/workspaces/{workspace_id}/folders", status_code=201)
async def create_folder(
    workspace_id: str,
    body: FolderCreate,
    path: str = Query(default="/"),
):
    _ensure_workspace(workspace_id)

    local_prefix = _resolve_local_path(workspace_id, path)
    folder_path = f"{local_prefix}{body.name}"

    if local_cache.exists(folder_path):
        raise HTTPException(409, "Folder already exists")

    placeholder_path = f"{folder_path}/.keep"
    write_file_blob(placeholder_path, b"", {"content_type": "application/octet-stream"})

    ts = now_iso()
    meta = {"name": body.name, "created_at": ts, "updated_at": ts}
    meta_path = f"{folder_path}/{FOLDER_META}"
    write_json_blob(meta_path, meta)

    _update_workspace_counts(workspace_id)

    return {
        "name": body.name,
        "type": "folder",
        "path": f"{path.rstrip('/')}/{body.name}".lstrip("/"),
        "created_at": ts,
    }


# ── Rename folder ─────────────────────────────────────────────────


class FolderRename(BaseModel):
    new_name: str = Field(..., min_length=1, max_length=200)


@router.patch("/workspaces/{workspace_id}/folders")
async def rename_folder(
    workspace_id: str,
    body: FolderRename,
    path: str = Query(..., description="Current folder path"),
):
    _ensure_workspace(workspace_id)

    old_prefix = _resolve_local_path(workspace_id, path).rstrip("/")
    parent = "/".join(path.strip("/").split("/")[:-1]) or "/"
    new_prefix = _resolve_local_path(workspace_id, f"{parent.rstrip('/')}/{body.new_name}").rstrip("/")

    if not local_cache.exists(old_prefix):
        raise HTTPException(404, "Folder not found")

    rename_prefix(old_prefix + "/", new_prefix + "/")

    _update_workspace_counts(workspace_id)
    return {"renamed": True, "new_path": f"{parent.rstrip('/')}/{body.new_name}".lstrip("/")}


# ── Delete folder ──────────────────────────────────────────────────


@router.delete("/workspaces/{workspace_id}/folders")
async def delete_folder(
    workspace_id: str,
    path: str = Query(..., description="Folder path to delete"),
):
    _ensure_workspace(workspace_id)

    local_prefix = _resolve_local_path(workspace_id, path).rstrip("/")
    if not local_cache.exists(local_prefix):
        raise HTTPException(404, "Folder not found")

    delete_prefix(local_prefix)

    _update_workspace_counts(workspace_id)
    return {"deleted": path}


# ── Upload file(s) ────────────────────────────────────────────────


@router.post("/workspaces/{workspace_id}/files", status_code=201)
async def upload_files(
    workspace_id: str,
    files: list[UploadFile] = File(...),
    path: str = Form(default="/"),
    status: str = Form(default="uploaded"),
):
    _ensure_workspace(workspace_id)

    uploaded = []
    for f in files:
        content = await f.read()
        file_path = _file_local_path(workspace_id, path, f.filename)
        content_type = f.content_type or mimetypes.guess_type(f.filename)[0] or "application/octet-stream"
        metadata = {
            "status": status,
            "original_name": f.filename,
            "content_type": content_type,
            "size": len(content),
            "time_created": now_iso(),
            "updated": now_iso(),
        }
        write_file_blob(file_path, content, metadata)

        uploaded.append({
            "name": f.filename,
            "type": "file",
            "path": f"{path.rstrip('/')}/{f.filename}".lstrip("/"),
            "size": len(content),
            "content_type": content_type,
            "status": status,
        })

    _update_workspace_counts(workspace_id)
    return {"uploaded": uploaded}


# ── Get file details ───────────────────────────────────────────────


@router.get("/workspaces/{workspace_id}/files")
async def get_file(
    workspace_id: str,
    path: str = Query(..., description="File path relative to workspace root"),
):
    _ensure_workspace(workspace_id)
    ws_prefix = workspace_prefix(workspace_id)
    file_path = f"{ws_prefix}{path.lstrip('/')}"

    if not blob_exists(file_path):
        raise HTTPException(404, "File not found")

    metadata = local_cache.read_metadata(file_path)
    size = local_cache.get_file_size(file_path)
    ext = PurePosixPath(path).suffix.lstrip(".").lower()

    return {
        "name": PurePosixPath(path).name,
        "path": path,
        "size": size,
        "content_type": metadata.get("content_type", "application/octet-stream"),
        "extension": ext,
        "status": metadata.get("status", "uploaded"),
        "created_at": metadata.get("time_created"),
        "updated_at": metadata.get("updated"),
        "metadata": {k: v for k, v in metadata.items() if k not in ("content_type", "size", "time_created", "updated")},
    }


# ── Update file metadata (status, etc.) ───────────────────────────


class FileUpdate(BaseModel):
    status: str | None = None
    name: str | None = None


@router.patch("/workspaces/{workspace_id}/files")
async def update_file(
    workspace_id: str,
    body: FileUpdate,
    path: str = Query(...),
):
    _ensure_workspace(workspace_id)
    ws_prefix = workspace_prefix(workspace_id)
    file_path = f"{ws_prefix}{path.lstrip('/')}"

    if not blob_exists(file_path):
        raise HTTPException(404, "File not found")

    if body.status:
        metadata = local_cache.read_metadata(file_path)
        metadata["status"] = body.status
        metadata["updated"] = now_iso()
        local_cache._write_metadata(file_path, metadata)
        from sync import sync_engine, SyncOp, OpType
        content = local_cache.read_file(file_path)
        if content is not None:
            sync_engine.enqueue(SyncOp(op=OpType.WRITE_FILE, path=file_path, data=content, metadata=metadata))

    if body.name:
        parent = str(PurePosixPath(path).parent)
        new_path = _file_local_path(workspace_id, parent, body.name)
        rename_blob(file_path, new_path)
        return {"renamed": True, "new_path": f"{parent.rstrip('/')}/{body.name}".lstrip("/")}

    return {"updated": True}


# ── Delete file ────────────────────────────────────────────────────


@router.delete("/workspaces/{workspace_id}/files")
async def delete_file(
    workspace_id: str,
    path: str = Query(...),
):
    _ensure_workspace(workspace_id)
    ws_prefix = workspace_prefix(workspace_id)
    file_path = f"{ws_prefix}{path.lstrip('/')}"

    if not blob_exists(file_path):
        raise HTTPException(404, "File not found")

    delete_blob(file_path)
    _update_workspace_counts(workspace_id)
    return {"deleted": path}


# ── Bulk delete ────────────────────────────────────────────────────


class BulkDelete(BaseModel):
    paths: list[str]


@router.post("/workspaces/{workspace_id}/files/bulk-delete")
async def bulk_delete_files(
    workspace_id: str,
    body: BulkDelete,
):
    _ensure_workspace(workspace_id)
    ws_prefix = workspace_prefix(workspace_id)

    deleted = []
    for p in body.paths:
        file_path = f"{ws_prefix}{p.lstrip('/')}"
        if blob_exists(file_path):
            delete_blob(file_path)
            deleted.append(p)

    _update_workspace_counts(workspace_id)
    return {"deleted": deleted}


# ── Move file ──────────────────────────────────────────────────────


class FileMove(BaseModel):
    source_paths: list[str]
    destination_folder: str


@router.post("/workspaces/{workspace_id}/files/move")
async def move_files(
    workspace_id: str,
    body: FileMove,
):
    _ensure_workspace(workspace_id)
    ws_prefix = workspace_prefix(workspace_id)

    moved = []
    for src in body.source_paths:
        src_path = f"{ws_prefix}{src.lstrip('/')}"
        if not blob_exists(src_path):
            continue
        filename = PurePosixPath(src).name
        dst_path = _file_local_path(workspace_id, body.destination_folder, filename)
        rename_blob(src_path, dst_path)
        moved.append({"from": src, "to": f"{body.destination_folder.rstrip('/')}/{filename}".lstrip("/")})

    _update_workspace_counts(workspace_id)
    return {"moved": moved}


# ── Download URL (signed) ─────────────────────────────────────────


@router.get("/workspaces/{workspace_id}/files/download-url")
async def get_download_url(
    workspace_id: str,
    path: str = Query(...),
):
    _ensure_workspace(workspace_id)
    ws_prefix = workspace_prefix(workspace_id)
    file_path = f"{ws_prefix}{path.lstrip('/')}"

    if not blob_exists(file_path):
        raise HTTPException(404, "File not found")

    bucket = get_bucket()
    blob = bucket.blob(file_path)
    url = blob.generate_signed_url(expiration=timedelta(hours=1), method="GET")
    return {"url": url, "expires_in": 3600}
