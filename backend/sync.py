"""
Background sync engine:
- Cold-start hydration: pull all objects from GCS into local cache
- Write-behind: flush dirty queue to GCS periodically
- Reconciliation: periodic full diff between local and GCS
"""

import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from enum import Enum
from typing import Any

import local_cache
from gcs_client import get_bucket, WORKSPACE_ROOT

logger = logging.getLogger(__name__)

SYNC_INTERVAL_SECONDS = 5
RECONCILE_INTERVAL_SECONDS = 60


class OpType(Enum):
    WRITE_JSON = "write_json"
    WRITE_FILE = "write_file"
    DELETE = "delete"
    RENAME = "rename"


@dataclass
class SyncOp:
    op: OpType
    path: str
    data: dict | bytes | None = None
    metadata: dict[str, Any] | None = None
    new_path: str | None = None  # for renames


class SyncEngine:
    def __init__(self):
        self._dirty_queue: list[SyncOp] = []
        self._lock = threading.Lock()
        self._hydrated = threading.Event()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def is_hydrated(self) -> bool:
        return self._hydrated.is_set()

    def enqueue(self, op: SyncOp) -> None:
        with self._lock:
            self._dirty_queue.append(op)

    def hydrate(self) -> None:
        """Download all objects from GCS into local cache. Blocks until complete."""
        logger.info("Starting hydration from GCS...")
        local_cache.ensure_cache_dir()
        bucket = get_bucket()
        prefix = f"{WORKSPACE_ROOT}/"
        blobs = list(bucket.list_blobs(prefix=prefix))

        def _download(blob):
            try:
                rel_path = blob.name
                local_fp = local_cache._full_path(rel_path)
                local_fp.parent.mkdir(parents=True, exist_ok=True)

                content = blob.download_as_bytes()
                local_fp.write_bytes(content)

                if blob.metadata:
                    local_cache._write_metadata(rel_path, {
                        "content_type": blob.content_type,
                        "size": blob.size,
                        "status": (blob.metadata or {}).get("status", "uploaded"),
                        "original_name": (blob.metadata or {}).get("original_name", ""),
                        "time_created": blob.time_created.isoformat() if blob.time_created else None,
                        "updated": blob.updated.isoformat() if blob.updated else None,
                        **(blob.metadata or {}),
                    })
                else:
                    local_cache._write_metadata(rel_path, {
                        "content_type": blob.content_type,
                        "size": blob.size,
                        "time_created": blob.time_created.isoformat() if blob.time_created else None,
                        "updated": blob.updated.isoformat() if blob.updated else None,
                    })
            except Exception:
                logger.exception(f"Failed to download blob: {blob.name}")

        with ThreadPoolExecutor(max_workers=16) as pool:
            pool.map(_download, blobs)

        self._hydrated.set()
        logger.info(f"Hydration complete: {len(blobs)} objects cached locally.")

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, daemon=True, name="sync-engine")
        self._thread.start()

    def stop(self) -> None:
        """Stop the sync loop and flush remaining items."""
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=30)
        self._flush()

    def _run(self) -> None:
        last_reconcile = time.time()
        while not self._stop_event.is_set():
            self._stop_event.wait(timeout=SYNC_INTERVAL_SECONDS)
            self._flush()

            if time.time() - last_reconcile >= RECONCILE_INTERVAL_SECONDS:
                self._reconcile()
                last_reconcile = time.time()

    def _flush(self) -> None:
        with self._lock:
            ops = list(self._dirty_queue)
            self._dirty_queue.clear()

        if not ops:
            return

        logger.info(f"Flushing {len(ops)} operations to GCS...")
        bucket = get_bucket()

        for op in ops:
            try:
                if op.op == OpType.WRITE_JSON:
                    blob = bucket.blob(op.path)
                    blob.upload_from_string(
                        json.dumps(op.data, default=str),
                        content_type="application/json",
                    )
                elif op.op == OpType.WRITE_FILE:
                    blob = bucket.blob(op.path)
                    content_type = (op.metadata or {}).get("content_type", "application/octet-stream")
                    blob.metadata = {
                        k: v for k, v in (op.metadata or {}).items()
                        if k not in ("content_type", "size", "time_created", "updated")
                    }
                    blob.upload_from_string(op.data, content_type=content_type)
                elif op.op == OpType.DELETE:
                    blob = bucket.blob(op.path)
                    if blob.exists():
                        blob.delete()
                elif op.op == OpType.RENAME:
                    src_blob = bucket.blob(op.path)
                    if src_blob.exists():
                        bucket.rename_blob(src_blob, op.new_path)
            except Exception:
                logger.exception(f"Failed to sync op {op.op.value} for {op.path}")

    def _reconcile(self) -> None:
        """Pull any objects from GCS that are missing locally."""
        try:
            bucket = get_bucket()
            prefix = f"{WORKSPACE_ROOT}/"
            for blob in bucket.list_blobs(prefix=prefix):
                local_fp = local_cache._full_path(blob.name)
                if not local_fp.exists():
                    logger.info(f"Reconcile: downloading missing {blob.name}")
                    local_fp.parent.mkdir(parents=True, exist_ok=True)
                    content = blob.download_as_bytes()
                    local_fp.write_bytes(content)
                    if blob.metadata:
                        local_cache._write_metadata(blob.name, {
                            "content_type": blob.content_type,
                            "size": blob.size,
                            **(blob.metadata or {}),
                            "time_created": blob.time_created.isoformat() if blob.time_created else None,
                            "updated": blob.updated.isoformat() if blob.updated else None,
                        })
        except Exception:
            logger.exception("Reconciliation failed")


sync_engine = SyncEngine()
