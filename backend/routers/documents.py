import json
import mimetypes
import zipfile
from datetime import timedelta
from io import BytesIO
from pathlib import PurePosixPath
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

import local_cache
from rag.jobs import enqueue_delete, enqueue_index
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
        folder_prefix = f"{local_prefix}{folder_name}/"
        nested_files = local_cache.list_all_files(folder_prefix.rstrip("/"))
        file_count = 0
        for nested in nested_files:
            rel_nested = nested[len(folder_prefix):]
            if rel_nested and not rel_nested.startswith(".") and not PurePosixPath(rel_nested).name.startswith("."):
                file_count += 1
        folders.append({
            "name": folder_name,
            "type": "folder",
            "path": f"{path.rstrip('/')}/{folder_name}".lstrip("/"),
            "created_at": folder_meta.get("created_at"),
            "updated_at": folder_meta.get("updated_at"),
            "file_count": file_count,
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

    existing_files = local_cache.list_all_files(old_prefix)
    rename_prefix(old_prefix + "/", new_prefix + "/")
    ws_prefix_for_rename = workspace_prefix(workspace_id)
    new_rel_prefix = new_prefix[len(ws_prefix_for_rename):].strip("/")
    for old_file in existing_files:
        rel_old = old_file[len(ws_prefix_for_rename):].lstrip("/")
        suffix = old_file[len(old_prefix):].lstrip("/")
        if rel_old and not PurePosixPath(rel_old).name.startswith("."):
            enqueue_delete(workspace_id, rel_old)
            enqueue_index(workspace_id, f"{new_rel_prefix}/{suffix}".strip("/"))

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

    for existing_file in local_cache.list_all_files(local_prefix):
        rel_existing = existing_file[len(workspace_prefix(workspace_id)):].lstrip("/")
        if rel_existing and not PurePosixPath(rel_existing).name.startswith("."):
            enqueue_delete(workspace_id, rel_existing)
    delete_prefix(local_prefix)

    _update_workspace_counts(workspace_id)
    return {"deleted": path}


# ── Upload file(s) ────────────────────────────────────────────────

MAX_UPLOAD_SIZE = 100 * 1024 * 1024  # 100 MB per part


@router.post("/workspaces/{workspace_id}/files", status_code=201)
async def upload_files(workspace_id: str, request: Request):
    _ensure_workspace(workspace_id)

    form = await request.form(max_part_size=MAX_UPLOAD_SIZE)
    path = form.get("path", "/")
    status = form.get("status", "uploaded")
    files = form.getlist("files")

    if not files:
        raise HTTPException(status_code=422, detail="No files provided")

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
        rel_path = f"{path.rstrip('/')}/{f.filename}".lstrip("/")
        enqueue_index(workspace_id, rel_path)

        uploaded.append({
            "name": f.filename,
            "type": "file",
            "path": rel_path,
            "size": len(content),
            "content_type": content_type,
            "status": status,
        })

    await form.close()
    _update_workspace_counts(workspace_id)
    return {"uploaded": uploaded}


@router.post("/workspaces/{workspace_id}/files/import-zip", status_code=201)
async def import_zip(
    workspace_id: str,
    file: UploadFile = File(...),
    path: str = Form(default="/"),
):
    _ensure_workspace(workspace_id)

    filename = file.filename or ""
    if not filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only .zip files are supported")

    try:
        raw = await file.read()
        archive = zipfile.ZipFile(BytesIO(raw))
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="Invalid zip archive") from exc

    base_name = PurePosixPath(filename).stem.strip() or "archive"
    root_prefix = _resolve_local_path(workspace_id, path)
    target_root = f"{root_prefix}{base_name}/"
    imported_count = 0
    now = now_iso()

    for info in archive.infolist():
        if info.is_dir():
            continue

        member = info.filename.replace("\\", "/")
        if member.startswith("/") or member.startswith("../") or "/../" in member:
            continue
        if member.startswith("__MACOSX/"):
            continue

        member_path = PurePosixPath(member)
        if not member_path.name or member_path.name.startswith("."):
            continue

        file_bytes = archive.read(info)
        content_type = mimetypes.guess_type(member_path.name)[0] or "application/octet-stream"
        destination = f"{target_root}{member_path.as_posix().lstrip('/')}"
        metadata = {
            "status": "uploaded",
            "original_name": member_path.name,
            "content_type": content_type,
            "size": len(file_bytes),
            "time_created": now,
            "updated": now,
            "source": "zip_upload",
        }
        write_file_blob(destination, file_bytes, metadata)
        enqueue_index(workspace_id, destination[len(workspace_prefix(workspace_id)):].lstrip("/"))
        imported_count += 1

    await file.close()
    _update_workspace_counts(workspace_id)
    return {
        "folder_path": f"{path.rstrip('/')}/{base_name}".lstrip("/"),
        "imported_count": imported_count,
    }


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


@router.get("/workspaces/{workspace_id}/files/content")
async def get_file_content(
    workspace_id: str,
    path: str = Query(..., description="File path relative to workspace root"),
):
    _ensure_workspace(workspace_id)
    ws_prefix = workspace_prefix(workspace_id)
    file_path = f"{ws_prefix}{path.lstrip('/')}"

    if not blob_exists(file_path):
        raise HTTPException(404, "File not found")

    content = local_cache.read_file(file_path)
    if content is None:
        raise HTTPException(404, "File not found")

    metadata = local_cache.read_metadata(file_path)
    filename = PurePosixPath(path).name
    content_type = metadata.get("content_type") or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return Response(
        content=content,
        media_type=content_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


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
        enqueue_delete(workspace_id, path)
        enqueue_index(workspace_id, f"{parent.rstrip('/')}/{body.name}".lstrip("/"))
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
    enqueue_delete(workspace_id, path)
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
            enqueue_delete(workspace_id, p)
            deleted.append(p)

    _update_workspace_counts(workspace_id)
    return {"deleted": deleted}


# ── Move file ──────────────────────────────────────────────────────


class FileMove(BaseModel):
    source_paths: list[str]
    destination_folder: str


class TextFileWrite(BaseModel):
    path: str = Field(..., min_length=1, max_length=500)
    content: str = Field(default="")
    content_type: str = Field(default="text/markdown")


@router.put("/workspaces/{workspace_id}/files/text")
async def write_text_file(workspace_id: str, body: TextFileWrite):
    _ensure_workspace(workspace_id)
    clean_path = body.path.strip().lstrip("/")
    if not clean_path or clean_path.endswith("/"):
        raise HTTPException(status_code=422, detail="A file path is required")

    file_path = f"{workspace_prefix(workspace_id)}{clean_path}"
    encoded = body.content.encode("utf-8")
    write_file_blob(
        file_path,
        encoded,
        {
            "status": "generated",
            "original_name": PurePosixPath(clean_path).name,
            "content_type": body.content_type or "text/markdown",
            "size": len(encoded),
            "time_created": now_iso(),
            "updated": now_iso(),
        },
    )
    enqueue_index(workspace_id, clean_path)
    _update_workspace_counts(workspace_id)
    return {"path": clean_path, "size": len(encoded), "content_type": body.content_type}


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
        dst_rel = f"{body.destination_folder.rstrip('/')}/{filename}".lstrip("/")
        enqueue_delete(workspace_id, src)
        enqueue_index(workspace_id, dst_rel)
        moved.append({"from": src, "to": dst_rel})

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

    from gcs_client import get_credentials
    import google.auth
    import google.auth.transport.requests
    credentials = get_credentials()

    signing_kwargs: dict = {}
    if not isinstance(credentials, google.auth.credentials.Signing):
        if not credentials.valid:
            credentials.refresh(google.auth.transport.requests.Request())
        signing_kwargs["service_account_email"] = credentials.service_account_email
        signing_kwargs["access_token"] = credentials.token

    url = blob.generate_signed_url(
        expiration=timedelta(hours=1),
        method="GET",
        **signing_kwargs,
    )
    return {"url": url, "expires_in": 3600}
