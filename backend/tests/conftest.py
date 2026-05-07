"""
Shared fixtures for the backend test suite.

Key design decisions:
- local_cache.LOCAL_CACHE_DIR is redirected to a temp directory per-test
  so tests never touch /tmp/probe-cache.
- GCS clients are fully mocked — no network calls.
- sync_engine is replaced with a no-op stub so enqueue() is captured
  but nothing is flushed to GCS.
"""

import sys
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Ensure backend package root is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", "")


# ---------------------------------------------------------------------------
# Stub SyncEngine — captures enqueued ops without touching GCS
# ---------------------------------------------------------------------------

class StubSyncEngine:
    def __init__(self):
        self.ops: list = []
        self.is_hydrated = True

    def enqueue(self, op):
        self.ops.append(op)

    def hydrate(self):
        self.is_hydrated = True

    def start(self):
        pass

    def stop(self):
        pass

    def clear(self):
        self.ops.clear()


@pytest.fixture(autouse=True)
def _isolate_cache(tmp_path, monkeypatch):
    """Redirect local_cache to a per-test temp directory."""
    import local_cache

    monkeypatch.setattr(local_cache, "LOCAL_CACHE_DIR", tmp_path)


@pytest.fixture(autouse=True)
def _stub_sync(monkeypatch):
    """Replace the global sync_engine with a no-op stub."""
    import sync
    import storage

    stub = StubSyncEngine()
    monkeypatch.setattr(sync, "sync_engine", stub)
    monkeypatch.setattr(storage, "sync_engine", stub)
    yield stub


@pytest.fixture()
def stub_sync(_stub_sync):
    """Expose the stub sync engine so tests can inspect enqueued ops."""
    _stub_sync.clear()
    return _stub_sync


@pytest.fixture()
def mock_gcs_bucket():
    """Return a MagicMock for the GCS bucket, patching get_bucket everywhere it's imported."""
    bucket = MagicMock()
    with patch("gcs_client.get_bucket", return_value=bucket), \
         patch("gcs_client.get_client", return_value=MagicMock()), \
         patch("sync.get_bucket", return_value=bucket), \
         patch("storage.get_bucket", return_value=bucket):
        yield bucket


# ---------------------------------------------------------------------------
# FastAPI test client
# ---------------------------------------------------------------------------

@pytest.fixture()
def client():
    """
    Create an httpx AsyncClient bound to the FastAPI app.
    The lifespan is overridden so hydrate/start/stop don't run.
    """
    from contextlib import asynccontextmanager
    from httpx import AsyncClient, ASGITransport
    from fastapi import FastAPI
    from routers import workspaces, documents, search

    @asynccontextmanager
    async def _noop_lifespan(app: FastAPI):
        yield

    app = FastAPI(lifespan=_noop_lifespan)
    app.include_router(workspaces.router, prefix="/api")
    app.include_router(documents.router, prefix="/api")
    app.include_router(search.router, prefix="/api")

    from sync import sync_engine
    sync_engine.is_hydrated = True

    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")
