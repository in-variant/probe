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

ALLOWED_EMAIL_DOMAINS: set[str] = set()
_raw = os.getenv("ALLOWED_EMAIL_DOMAINS", "invariant-ai.com,akashalabdhi.space")
for d in _raw.split(","):
    d = d.strip().lower()
    if d:
        ALLOWED_EMAIL_DOMAINS.add(d)

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

    domain = email.split("@")[-1]
    if domain not in ALLOWED_EMAIL_DOMAINS:
        raise HTTPException(
            403,
            f"Access denied. Email domain @{domain} is not authorized.",
        )

    session_token = secrets.token_urlsafe(32)
    AUTH_SESSION_STORE[session_token] = {
        "email": email,
        "name": idinfo.get("name", ""),
        "picture": idinfo.get("picture", ""),
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
    }


@router.post("/logout")
async def logout(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        AUTH_SESSION_STORE.pop(token, None)
    return {"ok": True}
