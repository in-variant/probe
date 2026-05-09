"""
Admin-only RAG / Chroma maintenance (vectors only — never deletes GCS or workspace JSON).

Prefer running wipe during low traffic; concurrent index workers may race with collection deletion.
"""

from __future__ import annotations

import logging
import shutil

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from rag.chroma_store import collection_name, get_store, reset_store_singleton
from rag.jobs import index_queue
from routers.auth import _require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/rag", tags=["admin-rag"])

# Must match the string shown in the admin UI (frontend ADMIN_WIPE_CHROMA_PHRASE).
WIPE_CONFIRMATION_PHRASE = "DELETE CHROMA"


class ReindexWorkspaceBody(BaseModel):
    workspace_id: str = Field(..., min_length=1)


class WipeChromaBody(BaseModel):
    confirmation: str = Field(..., min_length=1)


@router.get("/diagnostics")
async def chroma_diagnostics(workspace_id: str, request: Request):
    _require_admin(request)
    queue_status = index_queue.status(workspace_id)
    store = get_store()
    all_collections = store.client.list_collections()
    workspace_collection = collection_name(workspace_id)
    disk = shutil.disk_usage(store.persist_dir)
    return {
        "workspace_id": workspace_id,
        "knowledge_base": {
            "state": "error" if queue_status.get("failed_count", 0) else ("indexing" if queue_status.get("queue_depth", 0) > 0 else "ready"),
            "indexed_chunk_count": store.chunk_count(workspace_id),
            "queue_depth": queue_status.get("queue_depth", 0),
            "pending_count": queue_status.get("pending_count", 0),
            "running_count": queue_status.get("running_count", 0),
            "processed_count": queue_status.get("processed_count", 0),
            "failed_count": queue_status.get("failed_count", 0),
            "last_error": queue_status.get("last_error"),
            "recent": queue_status.get("recent", []),
        },
        "collections": {
            "count": len(all_collections),
            "workspace_collection_name": workspace_collection,
            "workspace_collection_exists": any(c.name == workspace_collection for c in all_collections),
            "names": [c.name for c in all_collections],
        },
        "storage": {
            "persist_path": str(store.persist_dir),
            "total_bytes": disk.total,
            "used_bytes": disk.used,
            "free_bytes": disk.free,
        },
    }


@router.post("/reindex-workspace")
async def reindex_workspace(body: ReindexWorkspaceBody, request: Request):
    _require_admin(request)
    store = get_store()
    store.delete_workspace_collection(body.workspace_id.strip())
    enqueued = index_queue.enqueue_workspace(body.workspace_id.strip())
    logger.info("admin_reindex_workspace workspace=%s enqueued=%s", body.workspace_id, enqueued)
    return {"workspace_id": body.workspace_id.strip(), "enqueued": enqueued}


@router.post("/wipe-chroma")
async def wipe_chroma(body: WipeChromaBody, request: Request):
    _require_admin(request)
    if body.confirmation.strip() != WIPE_CONFIRMATION_PHRASE:
        raise HTTPException(status_code=422, detail="Invalid confirmation phrase")
    store = get_store()
    deleted = store.delete_all_collections()
    reset_store_singleton()
    logger.info("admin_wipe_chroma deleted_collections=%s", deleted)
    return {"deleted_collections": deleted}
