import logging
import re
from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from pydantic import BaseModel, Field

import local_cache
from storage import (
    workspace_prefix,
    workspace_meta_path,
    read_json_blob,
    write_json_blob,
    write_file_blob,
    delete_prefix,
    now_iso,
    WORKSPACE_ROOT,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["workspaces"])


class WorkspaceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    status: str = Field(default="active")
    google_drive_folder_id: str | None = Field(default=None, description="Google Drive folder ID to import files from")


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


def _update_import_status(workspace_id: str, status: str, imported: int = 0, total: int = 0):
    ws_meta = read_json_blob(workspace_meta_path(workspace_id)) or {}
    ws_meta["gdrive_import_status"] = status
    ws_meta["gdrive_imported_count"] = imported
    ws_meta["gdrive_total_count"] = total
    ws_meta["updated_at"] = now_iso()
    write_json_blob(workspace_meta_path(workspace_id), ws_meta)


def _recount_workspace(workspace_id: str):
    ws_prefix = workspace_prefix(workspace_id)
    all_files = local_cache.list_all_files(ws_prefix.rstrip("/"))
    file_count = 0
    folder_count = 0
    seen_folders: set[str] = set()
    for f in all_files:
        rel = f[len(ws_prefix):]
        if not rel or rel.startswith("."):
            continue
        parts = rel.split("/")
        if len(parts) > 1 and parts[0] not in seen_folders:
            seen_folders.add(parts[0])
            folder_count += 1
        if parts[-1] and not parts[-1].startswith("."):
            file_count += 1

    ws_meta = read_json_blob(workspace_meta_path(workspace_id)) or {}
    ws_meta["file_count"] = file_count
    ws_meta["folder_count"] = folder_count
    ws_meta["updated_at"] = now_iso()
    write_json_blob(workspace_meta_path(workspace_id), ws_meta)


def _import_drive_folder(workspace_id: str, folder_id: str, token_info: dict):
    """Background task: import files from a Google Drive folder into a workspace."""
    from gdrive_client import list_folder_recursive, download_file

    try:
        drive_files = list_folder_recursive(token_info, folder_id)
    except Exception:
        logger.exception("GDrive import: failed to list folder %s", folder_id)
        _update_import_status(workspace_id, "failed")
        return

    total = len(drive_files)
    _update_import_status(workspace_id, "importing", imported=0, total=total)

    ws_prefix = workspace_prefix(workspace_id)
    imported = 0

    for df in drive_files:
        try:
            result = download_file(token_info, df["id"], df["mimeType"])
            if result is None:
                logger.info("GDrive import: skipping unsupported type %s for %s", df["mimeType"], df.get("name"))
                continue

            content, ext, content_type = result
            filename = df["path"]
            if ext and not filename.endswith(ext):
                filename += ext

            file_path = f"{ws_prefix}{filename}"
            file_metadata = {
                "status": "uploaded",
                "original_name": df["name"],
                "content_type": content_type,
                "size": len(content),
                "time_created": now_iso(),
                "updated": now_iso(),
                "source": "google_drive",
                "drive_file_id": df["id"],
            }
            write_file_blob(file_path, content, file_metadata)
            imported += 1
            _update_import_status(workspace_id, "importing", imported=imported, total=total)
        except Exception:
            logger.warning("GDrive import: failed to download %s", df.get("name"), exc_info=True)

    _recount_workspace(workspace_id)
    _update_import_status(workspace_id, "completed", imported=imported, total=total)
    logger.info("GDrive import: imported %d/%d files into workspace %s", imported, total, workspace_id)


@router.post("/workspaces", status_code=201)
async def create_workspace(body: WorkspaceCreate, background_tasks: BackgroundTasks, request: Request):
    if body.name.strip().lower() in _existing_workspace_names():
        raise HTTPException(409, "A workspace with this name already exists")

    slug = slugify(body.name)

    existing_ids = _list_workspace_ids()
    final_slug = slug
    counter = 1
    while final_slug in existing_ids:
        final_slug = f"{slug}-{counter}"
        counter += 1

    ws_prefix = workspace_prefix(final_slug)
    for placeholder_path in (
        f"{ws_prefix}.keep",
        f"{ws_prefix}.comments/.keep",
        f"{ws_prefix}.chats/.keep",
        f"{ws_prefix}.traces/.keep",
        f"{ws_prefix}.requests/.keep",
        f"{ws_prefix}.roadmaps/.keep",
    ):
        write_file_blob(placeholder_path, b"", {"content_type": "application/octet-stream"})

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

    if body.google_drive_folder_id:
        meta["google_drive_folder_id"] = body.google_drive_folder_id
        meta["gdrive_import_status"] = "importing"

    write_json_blob(workspace_meta_path(final_slug), meta)

    if body.google_drive_folder_id:
        from routers.auth import get_current_user, get_drive_token_from_session
        try:
            session = get_current_user(request)
            token_info = get_drive_token_from_session(session)
            background_tasks.add_task(
                _import_drive_folder,
                final_slug,
                body.google_drive_folder_id,
                token_info,
            )
        except Exception:
            logger.warning("Could not get Drive token for background import")
            _update_import_status(final_slug, "failed")

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
