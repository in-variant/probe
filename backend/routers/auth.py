"""
Google OAuth 2.0 authentication router.

Provides login via Google with email domain restrictions.
Only emails from allowed domains can access the application.

Endpoints:
  GET  /api/auth/login       → returns the Google OAuth consent URL
  POST /api/auth/callback    → exchanges auth code for tokens, validates email
  GET  /api/auth/me          → returns current user info
  POST /api/auth/logout      → invalidates the session
"""

import logging
import os
import secrets
from typing import Any

os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from gdrive_client import (
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    ALLOWED_REDIRECT_ORIGINS,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

ADMIN_EMAIL = "anshsarkar18@gmail.com"
ROLES_PATH = "auth/roles.json"
VALID_ROLES = {"ADMIN", "CLIENT", "INVARIANT"}

INVARIANT_EMAIL_DOMAIN = "invariant-ai.com"

ALLOWED_EMAIL_DOMAINS: set[str] = set()
_raw = os.getenv("ALLOWED_EMAIL_DOMAINS", "invariant-ai.com,akashalabdhi.space")
for d in _raw.split(","):
    d = d.strip().lower()
    if d:
        ALLOWED_EMAIL_DOMAINS.add(d)

ALLOWED_EMAILS: set[str] = {ADMIN_EMAIL}
_raw_emails = os.getenv("ALLOWED_EMAILS", "")
for e in _raw_emails.split(","):
    e = e.strip().lower()
    if e:
        ALLOWED_EMAILS.add(e)

LOGIN_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/drive.readonly",
]

AUTH_SESSION_STORE: dict[str, dict[str, Any]] = {}

CALLBACK_PATH = "/gdrive/callback"


def _validate_origin(origin: str) -> str:
    origin = origin.rstrip("/")
    if origin not in ALLOWED_REDIRECT_ORIGINS:
        raise ValueError(f"Origin not allowed: {origin}")
    return origin


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
        scopes=LOGIN_SCOPES,
        redirect_uri=redirect_uri,
    )


_pending_flows: dict[str, str] = {}


@router.get("/login")
async def login(
    origin: str = Query(..., description="Frontend origin"),
):
    origin = _validate_origin(origin)
    redirect_uri = f"{origin}{CALLBACK_PATH}"
    flow = _build_flow(redirect_uri)
    url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )

    flow_id = secrets.token_urlsafe(16)
    _pending_flows[flow_id] = flow.code_verifier
    return {"url": url, "flow_id": flow_id}


class AuthCallback(BaseModel):
    code: str
    origin: str
    flow_id: str


class MemberRoleUpdate(BaseModel):
    email: str
    role: str


def _default_roles() -> dict[str, Any]:
    return {
        "members": {
            ADMIN_EMAIL: {
                "email": ADMIN_EMAIL,
                "role": "ADMIN",
                "allowed": True,
                "created_at": None,
                "updated_at": None,
            }
        }
    }


def _read_roles() -> dict[str, Any]:
    from storage import read_json_blob, write_json_blob, now_iso

    existing_data = read_json_blob(ROLES_PATH)
    data = existing_data or _default_roles()
    members = data.setdefault("members", {})
    changed = existing_data is None
    ts = now_iso()
    for email in ALLOWED_EMAILS:
        member = members.get(email)
        if not member:
            members[email] = {
                "email": email,
                "role": "ADMIN" if email == ADMIN_EMAIL else "CLIENT",
                "allowed": True,
                "created_at": ts,
                "updated_at": ts,
            }
            changed = True
    for em, mem in list(members.items()):
        if not isinstance(mem, dict):
            continue
        if (
            em.endswith(f"@{INVARIANT_EMAIL_DOMAIN}")
            and em != ADMIN_EMAIL
            and str(mem.get("role", "")).upper() == "CLIENT"
        ):
            mem["role"] = "INVARIANT"
            mem["updated_at"] = ts
            changed = True
    admin = members.get(ADMIN_EMAIL)
    if not admin or admin.get("role") != "ADMIN" or not admin.get("allowed", True):
        members[ADMIN_EMAIL] = {
            "email": ADMIN_EMAIL,
            "role": "ADMIN",
            "allowed": True,
            "created_at": admin.get("created_at") if isinstance(admin, dict) else ts,
            "updated_at": ts,
        }
        changed = True
    if changed:
        data["updated_at"] = ts
        write_json_blob(ROLES_PATH, data)
    return data


def _write_roles(data: dict[str, Any]) -> None:
    from storage import write_json_blob, now_iso

    data["updated_at"] = now_iso()
    write_json_blob(ROLES_PATH, data)


def _member_for_email(email: str) -> dict[str, Any] | None:
    members = _read_roles().get("members", {})
    member = members.get(email.lower())
    return member if isinstance(member, dict) else None


def _infer_default_role(email: str) -> str:
    """Role when the user has no row in roles.json (domain / allowlist policy)."""
    email = email.lower()
    if email == ADMIN_EMAIL:
        return "ADMIN"
    domain = email.split("@")[-1]
    if domain == INVARIANT_EMAIL_DOMAIN:
        return "INVARIANT"
    return "CLIENT"


def _role_for_email(email: str) -> str:
    member = _member_for_email(email)
    if member and member.get("allowed", True):
        return str(member.get("role") or "CLIENT").upper()
    return _infer_default_role(email)


def _is_email_allowed(email: str) -> bool:
    email = email.lower()
    domain = email.split("@")[-1]
    member = _member_for_email(email)
    return email in ALLOWED_EMAILS or domain in ALLOWED_EMAIL_DOMAINS or bool(member and member.get("allowed", True))


def _require_admin(request: Request) -> dict[str, Any]:
    session = get_current_user(request)
    if str(session.get("role", "")).upper() != "ADMIN":
        raise HTTPException(403, "Admin access required")
    return session


@router.post("/callback")
async def auth_callback(body: AuthCallback):
    origin = _validate_origin(body.origin)
    redirect_uri = f"{origin}{CALLBACK_PATH}"
    flow = _build_flow(redirect_uri)

    code_verifier = _pending_flows.pop(body.flow_id, None)
    if code_verifier:
        flow.code_verifier = code_verifier

    try:
        flow.fetch_token(code=body.code)
    except Exception as exc:
        logger.error("Auth token exchange failed: %s", exc)
        raise HTTPException(400, "Failed to exchange authorization code") from exc

    creds = flow.credentials

    from google.oauth2 import id_token
    from google.auth.transport.requests import Request as GoogleRequest

    try:
        idinfo = id_token.verify_oauth2_token(
            creds.id_token, GoogleRequest(), GOOGLE_OAUTH_CLIENT_ID
        )
    except Exception as exc:
        logger.error("ID token verification failed: %s", exc)
        raise HTTPException(400, "Invalid ID token") from exc

    email = idinfo.get("email", "").lower()
    if not email:
        raise HTTPException(403, "No email in Google account")

    if not _is_email_allowed(email):
        raise HTTPException(
            403,
            "Access denied. This email is not authorized.",
        )

    role = _role_for_email(email)
    session_token = secrets.token_urlsafe(32)
    AUTH_SESSION_STORE[session_token] = {
        "email": email,
        "name": idinfo.get("name", ""),
        "picture": idinfo.get("picture", ""),
        "role": role,
        "google_token": creds.token,
        "google_refresh_token": creds.refresh_token,
        "google_token_uri": creds.token_uri,
        "google_client_id": creds.client_id,
        "google_client_secret": creds.client_secret,
        "google_scopes": list(creds.scopes or []),
    }

    return {
        "session_token": session_token,
        "user": {
            "email": email,
            "name": idinfo.get("name", ""),
            "picture": idinfo.get("picture", ""),
            "role": role,
        },
    }


def get_current_user(request: Request) -> dict[str, Any]:
    """Extract and validate the session from the Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    token = auth_header[7:]
    session = AUTH_SESSION_STORE.get(token)
    if not session:
        raise HTTPException(401, "Invalid or expired session")
    if "email" in session:
        session["role"] = _role_for_email(str(session["email"]))
    return session


def get_drive_token_from_session(session: dict[str, Any]) -> dict[str, Any]:
    """Extract Google Drive credentials from an auth session."""
    return {
        "token": session["google_token"],
        "refresh_token": session.get("google_refresh_token"),
        "token_uri": session.get("google_token_uri", "https://oauth2.googleapis.com/token"),
        "client_id": session.get("google_client_id", GOOGLE_OAUTH_CLIENT_ID),
        "client_secret": session.get("google_client_secret", GOOGLE_OAUTH_CLIENT_SECRET),
    }


@router.get("/me")
async def get_me(request: Request):
    session = get_current_user(request)
    return {
        "email": session["email"],
        "name": session["name"],
        "picture": session["picture"],
        "role": session.get("role", _role_for_email(session["email"])),
    }


@router.get("/members")
async def list_members(request: Request):
    _require_admin(request)
    members = _read_roles().get("members", {})
    return {
        "members": sorted(
            members.values(),
            key=lambda item: str(item.get("email", "")),
        ),
        "roles": sorted(VALID_ROLES),
    }


@router.patch("/members")
async def update_member_role(body: MemberRoleUpdate, request: Request):
    _require_admin(request)
    from storage import now_iso

    email = body.email.strip().lower()
    role = body.role.strip().upper()
    if not email or "@" not in email:
        raise HTTPException(422, "A valid email is required")
    if role not in VALID_ROLES:
        raise HTTPException(422, "Invalid role")

    data = _read_roles()
    members = data.setdefault("members", {})
    existing = members.get(email, {})
    ts = now_iso()
    members[email] = {
        "email": email,
        "role": role,
        "allowed": True,
        "created_at": existing.get("created_at") or ts,
        "updated_at": ts,
    }
    if email == ADMIN_EMAIL:
        members[email]["role"] = "ADMIN"
    _write_roles(data)
    for session in AUTH_SESSION_STORE.values():
        if session.get("email") == email:
            session["role"] = members[email]["role"]
    return members[email]


@router.post("/logout")
async def logout(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        AUTH_SESSION_STORE.pop(token, None)
    return {"ok": True}
