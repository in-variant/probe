"""
GCS client setup — isolated to avoid circular imports.
Both storage.py and sync.py import from here.
"""

from pathlib import Path
from google.cloud import storage
from google.oauth2 import service_account

BUCKET_NAME = "probe-akashalabdhi"
WORKSPACE_ROOT = "workspace"

SA_KEY_PATH = Path(__file__).parent / "invariant-ai-dev-3eae095dc7b6.json"

_credentials: service_account.Credentials | None = None
_client: storage.Client | None = None


SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]


def get_credentials() -> service_account.Credentials:
    global _credentials
    if _credentials is None:
        _credentials = service_account.Credentials.from_service_account_file(
            str(SA_KEY_PATH),
            scopes=SCOPES,
        )
    return _credentials


def get_project_id() -> str:
    return get_credentials().project_id


def get_client() -> storage.Client:
    global _client
    if _client is None:
        creds = get_credentials()
        _client = storage.Client(credentials=creds, project=creds.project_id)
    return _client


def get_bucket() -> storage.Bucket:
    return get_client().bucket(BUCKET_NAME)
