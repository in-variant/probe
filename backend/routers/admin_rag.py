"""
Admin-only RAG / Chroma maintenance (vectors only — never deletes GCS or workspace JSON).

Prefer running wipe during low traffic; concurrent index workers may race with collection deletion.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from rag.chroma_store import get_store, reset_store_singleton
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
