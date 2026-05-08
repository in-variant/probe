"""
Google Drive integration router.

All endpoints use the authenticated user's Google credentials (from the auth
session) for Drive access. No separate Drive OAuth flow is needed.

Endpoints:
  GET  /api/gdrive/folders             → list folders in user's Drive
  POST /api/gdrive/import/{workspace}  → pull files from a Drive folder into a workspace
"""

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

import local_cache
from storage import (
    workspace_prefix,
    workspace_meta_path,
    read_json_blob,
    write_json_blob,
    write_file_blob,
    now_iso,
)
from gdrive_client import (
    list_folder,
    download_file,
    list_folder_recursive,
)
from routers.auth import get_current_user, get_drive_token_from_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/gdrive", tags=["google-drive"])

# Keep legacy token store for backward compatibility with background tasks
_token_store: dict[str, dict[str, Any]] = {}


def _get_drive_token(request: Request) -> dict[str, Any]:
    """Get Drive token from the authenticated user's session."""
    session = get_current_user(request)
    return get_drive_token_from_session(session)


# ── Browse Drive ──────────────────────────────────────────────────


@router.get("/folders")
async def browse_folders(
    request: Request,
    folder_id: str = Query(default="root"),
):
    """List folders and files inside a Google Drive folder."""
    token_info = _get_drive_token(request)
    try:
        items = list_folder(token_info, folder_id)
    except Exception as exc:
        logger.error("Drive list failed: %s", exc)
        raise HTTPException(502, "Failed to list Google Drive folder") from exc

    folders = []
    files = []
    for item in items:
        entry = {
            "id": item["id"],
            "name": item["name"],
            "mimeType": item["mimeType"],
        }
        if item["mimeType"] == "application/vnd.google-apps.folder":
            folders.append(entry)
        else:
            entry["size"] = int(item.get("size", 0))
            entry["modifiedTime"] = item.get("modifiedTime")
            files.append(entry)

    return {"folder_id": folder_id, "folders": folders, "files": files}


# ── Import from Drive ─────────────────────────────────────────────


class DriveImportRequest(BaseModel):
    folder_id: str | None = Field(default=None, description="Google Drive folder ID to import from")
    parent_folder_id: str | None = Field(default=None, description="Parent folder ID used to resolve selected item IDs")
    file_ids: list[str] = Field(default_factory=list, description="Specific Drive file IDs to import")
    folder_ids: list[str] = Field(default_factory=list, description="Specific Drive folder IDs to import recursively")
    recursive: bool = Field(default=True, description="Import subfolders recursively")
    target_path: str = Field(default="/", description="Workspace folder path to import into")


@router.post("/import/{workspace_id}")
async def import_from_drive(workspace_id: str, body: DriveImportRequest, request: Request):
    """Download all files from a Drive folder into a workspace."""
    meta = read_json_blob(workspace_meta_path(workspace_id))
    if not meta:
        raise HTTPException(404, "Workspace not found")

    token_info = _get_drive_token(request)

    try:
        drive_files: list[dict] = []
        target_path = (body.target_path or "/").strip()
        if not target_path:
            target_path = "/"

        if body.file_ids or body.folder_ids:
            parent_folder_id = body.parent_folder_id or body.folder_id or "root"
            parent_items = list_folder(token_info, parent_folder_id)
            by_id = {item["id"]: item for item in parent_items}

            for file_id in body.file_ids:
                item = by_id.get(file_id)
                if not item:
                    continue
                if item["mimeType"] == "application/vnd.google-apps.folder":
                    continue
                drive_files.append({**item, "path": item["name"]})

            for folder_id in body.folder_ids:
                item = by_id.get(folder_id)
                if not item:
                    continue
                if item["mimeType"] != "application/vnd.google-apps.folder":
                    continue
                drive_files.extend(
                    list_folder_recursive(
                        token_info,
                        folder_id=folder_id,
                        prefix=f"{item['name']}/",
                    )
                )
        elif body.folder_id and body.recursive:
            drive_files = list_folder_recursive(token_info, body.folder_id)
        else:
            source_folder_id = body.folder_id or "root"
            all_items = list_folder(token_info, source_folder_id)
            drive_files = [
                {**f, "path": f["name"]}
                for f in all_items
                if f["mimeType"] != "application/vnd.google-apps.folder"
            ]
    except Exception as exc:
        logger.error("Drive listing failed: %s", exc)
        raise HTTPException(502, "Failed to list files from Google Drive") from exc

    ws_prefix = workspace_prefix(workspace_id)
    imported: list[dict] = []
    errors: list[dict] = []

    for df in drive_files:
        try:
            result = download_file(token_info, df["id"], df["mimeType"])
            if result is None:
                errors.append({"name": df.get("name", "unknown"), "error": "Unsupported file type"})
                continue

            content, ext, content_type = result
            relative_name = str(df["path"]).lstrip("/")
            if target_path == "/":
                filename = relative_name
            else:
                filename = f"{target_path.strip('/')}/{relative_name}"
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
            imported.append({"name": df["name"], "path": filename, "size": len(content)})
        except Exception as exc:
            logger.warning("Failed to import %s: %s", df.get("name"), exc)
            errors.append({"name": df.get("name", "unknown"), "error": str(exc)})

    _update_counts(workspace_id)

    return {
        "imported_count": len(imported),
        "error_count": len(errors),
        "imported": imported,
        "errors": errors,
    }


def _update_counts(workspace_id: str):
    """Re-count files/folders after import and update workspace meta."""
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
