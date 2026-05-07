"""
Google Drive integration router.

Endpoints:
  GET  /api/gdrive/auth-url           → returns the OAuth consent URL
  POST /api/gdrive/callback           → exchanges auth code for tokens
  GET  /api/gdrive/folders             → list folders in user's Drive
  POST /api/gdrive/import/{workspace}  → pull files from a Drive folder into a workspace
"""

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
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
    get_oauth_url,
    exchange_code,
    list_folder,
    download_file,
    list_folder_recursive,
    EXPORT_MIME_MAP,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/gdrive", tags=["google-drive"])

# In-memory token store keyed by a simple session token.
# In production this should be replaced with a proper session/DB store.
_token_store: dict[str, dict[str, Any]] = {}


# ── OAuth flow ────────────────────────────────────────────────────


@router.get("/auth-url")
async def auth_url(
    origin: str = Query(..., description="Frontend origin, e.g. https://akashalabdhi.invariant-ai.com"),
    state: str = Query(default=""),
):
    """Return the Google OAuth 2.0 consent URL."""
    try:
        url, flow_id = get_oauth_url(origin=origin, state=state)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"url": url, "flow_id": flow_id}


class OAuthCallback(BaseModel):
    code: str
    origin: str
    flow_id: str


@router.post("/callback")
async def oauth_callback(body: OAuthCallback):
    """Exchange the authorization code for tokens."""
    try:
        token_info = exchange_code(body.code, origin=body.origin, flow_id=body.flow_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.error("OAuth token exchange failed: %s", exc)
        raise HTTPException(400, "Failed to exchange authorization code") from exc

    import secrets
    session_token = secrets.token_urlsafe(32)
    _token_store[session_token] = token_info

    return {"session_token": session_token}


def _get_token(session_token: str) -> dict[str, Any]:
    token = _token_store.get(session_token)
    if not token:
        raise HTTPException(401, "Google Drive not connected. Please authenticate first.")
    return token


# ── Browse Drive ──────────────────────────────────────────────────


@router.get("/folders")
async def browse_folders(
    session_token: str = Query(...),
    folder_id: str = Query(default="root"),
):
    """List folders and files inside a Google Drive folder."""
    token_info = _get_token(session_token)
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
    session_token: str
    folder_id: str = Field(..., description="Google Drive folder ID to import from")
    recursive: bool = Field(default=True, description="Import subfolders recursively")


@router.post("/import/{workspace_id}")
async def import_from_drive(workspace_id: str, body: DriveImportRequest):
    """Download all files from a Drive folder into a workspace."""
    meta = read_json_blob(workspace_meta_path(workspace_id))
    if not meta:
        raise HTTPException(404, "Workspace not found")

    token_info = _get_token(body.session_token)

    try:
        if body.recursive:
            drive_files = list_folder_recursive(token_info, body.folder_id)
        else:
            all_items = list_folder(token_info, body.folder_id)
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
