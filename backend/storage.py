"""
Storage abstraction layer.
- Reads go to local filesystem cache (instant)
- Writes go to local filesystem + enqueue to background sync for GCS
- GCS client is still available for signed URLs and hydration
"""

from datetime import datetime, timezone
from typing import Any

import local_cache
from gcs_client import get_bucket, get_client, BUCKET_NAME, WORKSPACE_ROOT
from sync import sync_engine, SyncOp, OpType


def workspace_prefix(workspace_id: str) -> str:
    return f"{WORKSPACE_ROOT}/{workspace_id}/"


def workspace_meta_path(workspace_id: str) -> str:
    return f"{WORKSPACE_ROOT}/{workspace_id}/.meta.json"


def read_json_blob(path: str) -> dict | None:
    """Read JSON from local cache (instant)."""
    return local_cache.read_json(path)


def write_json_blob(path: str, data: dict) -> None:
    """Write JSON to local cache + enqueue GCS sync."""
    local_cache.write_json(path, data)
    sync_engine.enqueue(SyncOp(op=OpType.WRITE_JSON, path=path, data=data))


def write_file_blob(path: str, content: bytes, metadata: dict[str, Any] | None = None) -> None:
    """Write binary file to local cache + enqueue GCS sync."""
    local_cache.write_file(path, content, metadata)
    sync_engine.enqueue(SyncOp(op=OpType.WRITE_FILE, path=path, data=content, metadata=metadata))


def delete_blob(path: str) -> None:
    """Delete from local cache + enqueue GCS delete."""
    local_cache.delete_path(path)
    sync_engine.enqueue(SyncOp(op=OpType.DELETE, path=path))


def delete_prefix(prefix: str) -> None:
    """Delete all files under a prefix locally + enqueue GCS deletes."""
    all_files = local_cache.list_all_files(prefix)
    local_cache.delete_path(prefix)
    for f in all_files:
        sync_engine.enqueue(SyncOp(op=OpType.DELETE, path=f))


def rename_blob(old_path: str, new_path: str) -> None:
    """Rename in local cache + enqueue GCS rename."""
    local_cache.rename_path(old_path, new_path)
    sync_engine.enqueue(SyncOp(op=OpType.RENAME, path=old_path, new_path=new_path))


def rename_prefix(old_prefix: str, new_prefix: str) -> None:
    """Rename all files under a prefix (folder rename)."""
    all_files = local_cache.list_all_files(old_prefix)
    for f in all_files:
        new_f = new_prefix + f[len(old_prefix):]
        local_cache.rename_path(f, new_f)
        sync_engine.enqueue(SyncOp(op=OpType.RENAME, path=f, new_path=new_f))


def blob_exists(path: str) -> bool:
    """Check if a file exists in local cache."""
    return local_cache.exists(path)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
