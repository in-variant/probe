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

_client: storage.Client | None = None


def get_client() -> storage.Client:
    global _client
    if _client is None:
        credentials = service_account.Credentials.from_service_account_file(
            str(SA_KEY_PATH)
        )
        _client = storage.Client(credentials=credentials, project=credentials.project_id)
    return _client


def get_bucket() -> storage.Bucket:
    return get_client().bucket(BUCKET_NAME)
