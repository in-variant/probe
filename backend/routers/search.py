from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ai_harness import search_documents
import local_cache
from storage import WORKSPACE_ROOT

router = APIRouter(tags=["search"])


class SearchRequest(BaseModel):
    workspace_id: str = Field(..., min_length=1)
    query: str = Field(..., min_length=1, max_length=2000)
    session_id: str = Field(..., min_length=1)


@router.post("/search")
async def search(body: SearchRequest):
    prefix = f"{WORKSPACE_ROOT}/{body.workspace_id}"
    if not local_cache.exists(prefix):
        raise HTTPException(404, "Workspace not found")
    result = search_documents(body.workspace_id, body.query, body.session_id)
    return result
