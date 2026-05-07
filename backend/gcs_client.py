"""
GCS client setup — isolated to avoid circular imports.
Both storage.py and sync.py import from here.

Authentication order (handled by google.auth.default):
  1. GOOGLE_APPLICATION_CREDENTIALS env var  → local dev (points to SA key file)
  2. Cloud Run metadata server               → production (no key file needed)
  3. gcloud auth application-default login   → developer machines
"""

import google.auth
from google.cloud import storage

BUCKET_NAME = "probe-akashalabdhi"
WORKSPACE_ROOT = "workspace"

SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]

_credentials: google.auth.credentials.Credentials | None = None
_project_id: str | None = None
_client: storage.Client | None = None


def get_credentials() -> google.auth.credentials.Credentials:
    global _credentials, _project_id
    if _credentials is None:
        _credentials, _project_id = google.auth.default(scopes=SCOPES)
    return _credentials


def get_project_id() -> str:
    get_credentials()
    return _project_id or ""


def get_client() -> storage.Client:
    global _client
    if _client is None:
        creds = get_credentials()
        _client = storage.Client(credentials=creds, project=get_project_id())
    return _client


def get_bucket() -> storage.Bucket:
    return get_client().bucket(BUCKET_NAME)
