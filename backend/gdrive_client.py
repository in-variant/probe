"""
Google Drive API client for importing files/folders into workspaces.

Uses OAuth 2.0 for user-level access (the user authorises Probe to read
their Drive) and the Google Drive API v3 to list and download files.

Required env vars:
  GOOGLE_OAUTH_CLIENT_ID      – OAuth 2.0 client ID
  GOOGLE_OAUTH_CLIENT_SECRET  – OAuth 2.0 client secret

All three frontend origins must be registered as authorized redirect URIs
in the Google Cloud Console (each with the /api/gdrive/callback path).
The frontend passes its own origin so the correct redirect URI is used.
"""

import io
import logging
import os
from typing import Any

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

logger = logging.getLogger(__name__)

GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
GOOGLE_OAUTH_CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")

ALLOWED_REDIRECT_ORIGINS = {
    "http://localhost:3000",
    "https://probe-frontend-520296708682.us-central1.run.app",
    "https://akashalabdhi.invariant-ai.com",
}

CALLBACK_PATH = "/gdrive/callback"

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

EXPORT_MIME_MAP: dict[str, tuple[str, str]] = {
    "application/vnd.google-apps.document": ("application/pdf", ".pdf"),
    "application/vnd.google-apps.spreadsheet": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xlsx",
    ),
    "application/vnd.google-apps.presentation": (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".pptx",
    ),
    "application/vnd.google-apps.drawing": ("application/pdf", ".pdf"),
    "application/vnd.google-apps.jam": ("application/pdf", ".pdf"),
}

SKIP_MIME_TYPES = {
    "application/vnd.google-apps.form",
    "application/vnd.google-apps.map",
    "application/vnd.google-apps.site",
    "application/vnd.google-apps.script",
}

SHORTCUT_MIME = "application/vnd.google-apps.shortcut"
FOLDER_SHORTCUT_MIME = "application/vnd.google-apps.foldershortcut"


def _validate_redirect_uri(origin: str) -> str:
    """Validate that the origin is allowed and return the full redirect URI."""
    origin = origin.rstrip("/")
    if origin not in ALLOWED_REDIRECT_ORIGINS:
        raise ValueError(f"Origin not allowed: {origin}")
    return f"{origin}{CALLBACK_PATH}"


def _build_flow(redirect_uri: str):
    from google_auth_oauthlib.flow import Flow

    return Flow.from_client_config(
        {
            "web": {
                "client_id": GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=SCOPES,
        redirect_uri=redirect_uri,
    )


_pending_flows: dict[str, str] = {}


def get_oauth_url(origin: str, state: str = "") -> tuple[str, str]:
    """
    Return (consent_url, flow_id).
    The flow_id must be passed back to exchange_code so we can
    supply the PKCE code_verifier that Google requires.
    """
    import secrets as _secrets

    redirect_uri = _validate_redirect_uri(origin)
    flow = _build_flow(redirect_uri)
    url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=state,
    )

    flow_id = _secrets.token_urlsafe(16)
    _pending_flows[flow_id] = flow.code_verifier
    return url, flow_id


def exchange_code(code: str, origin: str, flow_id: str) -> dict[str, Any]:
    """Exchange an authorization code for tokens and return the credential dict."""
    redirect_uri = _validate_redirect_uri(origin)
    flow = _build_flow(redirect_uri)

    code_verifier = _pending_flows.pop(flow_id, None)
    if code_verifier:
        flow.code_verifier = code_verifier

    flow.fetch_token(code=code)
    creds = flow.credentials
    return {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes or []),
    }


def _build_service(token_info: dict[str, Any]):
    creds = Credentials(
        token=token_info["token"],
        refresh_token=token_info.get("refresh_token"),
        token_uri=token_info.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=token_info.get("client_id", GOOGLE_OAUTH_CLIENT_ID),
        client_secret=token_info.get("client_secret", GOOGLE_OAUTH_CLIENT_SECRET),
    )
    return build("drive", "v3", credentials=creds)


def list_folder(token_info: dict[str, Any], folder_id: str = "root") -> list[dict]:
    """List immediate children of a Drive folder (non-trashed).
    Shortcuts are resolved to their target file/folder."""
    service = _build_service(token_info)
    results: list[dict] = []
    page_token = None

    while True:
        resp = (
            service.files()
            .list(
                q=f"'{folder_id}' in parents and trashed = false",
                fields="nextPageToken, files(id, name, mimeType, size, modifiedTime, shortcutDetails)",
                pageSize=200,
                pageToken=page_token,
                orderBy="folder,name",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            )
            .execute()
        )
        for item in resp.get("files", []):
            if item["mimeType"] in (SHORTCUT_MIME, FOLDER_SHORTCUT_MIME):
                details = item.get("shortcutDetails", {})
                target_id = details.get("targetId")
                target_mime = details.get("targetMimeType")
                if target_id and target_mime:
                    item["id"] = target_id
                    item["mimeType"] = target_mime
                else:
                    continue
            results.append(item)
        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    return results


def download_file(token_info: dict[str, Any], file_id: str, mime_type: str) -> tuple[bytes, str, str] | None:
    """
    Download a single file from Drive.
    Returns (content_bytes, filename_extension, export_mime_type) or None if
    the file type cannot be downloaded or exported.
    """
    if mime_type in SKIP_MIME_TYPES or mime_type in (SHORTCUT_MIME, FOLDER_SHORTCUT_MIME):
        return None

    service = _build_service(token_info)

    if mime_type in EXPORT_MIME_MAP:
        export_mime, ext = EXPORT_MIME_MAP[mime_type]
        req = service.files().export_media(fileId=file_id, mimeType=export_mime)
    elif mime_type.startswith("application/vnd.google-apps."):
        export_mime, ext = "application/pdf", ".pdf"
        req = service.files().export_media(fileId=file_id, mimeType=export_mime)
    else:
        ext = ""
        export_mime = mime_type
        req = service.files().get_media(fileId=file_id, supportsAllDrives=True)

    buffer = io.BytesIO()
    downloader = MediaIoBaseDownload(buffer, req)
    done = False
    while not done:
        _, done = downloader.next_chunk()

    return buffer.getvalue(), ext, export_mime


def list_folder_recursive(
    token_info: dict[str, Any],
    folder_id: str = "root",
    prefix: str = "",
    max_depth: int = 10,
) -> list[dict]:
    """
    Recursively list all files in a Drive folder tree.
    Returns flat list of dicts with keys: id, name, mimeType, size, path.
    """
    if max_depth <= 0:
        return []

    items = list_folder(token_info, folder_id)
    result: list[dict] = []

    for item in items:
        item_path = f"{prefix}{item['name']}" if prefix else item["name"]
        if item["mimeType"] == "application/vnd.google-apps.folder":
            result.extend(
                list_folder_recursive(
                    token_info,
                    folder_id=item["id"],
                    prefix=f"{item_path}/",
                    max_depth=max_depth - 1,
                )
            )
        else:
            result.append({**item, "path": item_path})

    return result
