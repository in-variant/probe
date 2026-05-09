"""Workspace compliance roadmap (phases, tasks, file links) — INVARIANT + ADMIN only."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from routers.auth import get_current_user
from storage import now_iso, read_json_blob, workspace_prefix, write_json_blob

router = APIRouter(tags=["compliance-roadmap"])

ROADMAP_FILE = ".roadmaps/compliance.json"
MAX_PHASES = 40
MAX_TASKS_PER_PHASE = 120
MAX_PATH_LEN = 1024
MAX_LINK_LEN = 2048


def _roadmap_blob_path(workspace_id: str) -> str:
    return f"{workspace_prefix(workspace_id)}{ROADMAP_FILE}"


def _require_invariant_or_admin(request: Request) -> dict[str, Any]:
    session = get_current_user(request)
    role = str(session.get("role", "")).upper()
    if role not in ("INVARIANT", "ADMIN"):
        raise HTTPException(403, "Compliance roadmap is only available to Invariant consultants and admins")
    return session


def _require_roadmap_viewer(request: Request) -> dict[str, Any]:
    session = get_current_user(request)
    role = str(session.get("role", "")).upper()
    if role not in ("INVARIANT", "ADMIN", "CLIENT"):
        raise HTTPException(403, "Compliance roadmap is only available to workspace members")
    return session


class RoadmapTaskModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = ""
    title: str = Field(..., min_length=1, max_length=500)
    description: str = Field(default="", max_length=8000)
    start: str = Field(..., min_length=8, max_length=32)
    end: str = Field(..., min_length=8, max_length=32)
    file_paths: list[str] = Field(default_factory=list, max_length=50)
    links: list[str] = Field(default_factory=list, max_length=50)
    assignee_email: str | None = Field(default=None, max_length=320)

    @field_validator("file_paths")
    @classmethod
    def _paths(cls, v: list[str]) -> list[str]:
        for p in v:
            if len(p) > MAX_PATH_LEN or ".." in p:
                raise ValueError("Invalid file path")
        return v

    @field_validator("links")
    @classmethod
    def _links(cls, v: list[str]) -> list[str]:
        for u in v:
            if len(u) > MAX_LINK_LEN:
                raise ValueError("Link too long")
        return v


class RoadmapPhaseModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = ""
    name: str = Field(..., min_length=1, max_length=300)
    order: int = Field(default=0, ge=0, le=10_000)
    tasks: list[RoadmapTaskModel] = Field(default_factory=list, max_length=MAX_TASKS_PER_PHASE)


class ComplianceRoadmapPayload(BaseModel):
    phases: list[RoadmapPhaseModel] = Field(default_factory=list, max_length=MAX_PHASES)


class ComplianceRoadmapOut(BaseModel):
    phases: list[RoadmapPhaseModel]
    updated_at: str | None = None


def _normalize_payload(body: ComplianceRoadmapPayload) -> dict[str, Any]:
    phases_out: list[dict[str, Any]] = []
    for ph in sorted(body.phases, key=lambda p: p.order):
        pid = ph.id.strip() or str(uuid.uuid4())
        tasks_out: list[dict[str, Any]] = []
        for t in ph.tasks:
            tid = t.id.strip() or str(uuid.uuid4())
            tasks_out.append({
                "id": tid,
                "title": t.title.strip(),
                "description": t.description.strip(),
                "start": t.start.strip(),
                "end": t.end.strip(),
                "file_paths": list(t.file_paths),
                "links": list(t.links),
                "assignee_email": (t.assignee_email or "").strip().lower() or None,
            })
        phases_out.append({
            "id": pid,
            "name": ph.name.strip(),
            "order": ph.order,
            "tasks": tasks_out,
        })
    ts = now_iso()
    return {"phases": phases_out, "updated_at": ts}


@router.get("/workspaces/{workspace_id}/compliance-roadmap", response_model=ComplianceRoadmapOut)
async def get_compliance_roadmap(workspace_id: str, request: Request):
    _require_roadmap_viewer(request)
    from routers.documents import _ensure_workspace

    _ensure_workspace(workspace_id)
    raw = read_json_blob(_roadmap_blob_path(workspace_id))
    if not raw or not isinstance(raw.get("phases"), list):
        return ComplianceRoadmapOut(phases=[], updated_at=None)
    try:
        phases = [RoadmapPhaseModel(**p) for p in raw["phases"] if isinstance(p, dict)]
    except Exception as exc:
        raise HTTPException(500, "Stored roadmap is invalid") from exc
    return ComplianceRoadmapOut(phases=phases, updated_at=raw.get("updated_at"))


@router.patch("/workspaces/{workspace_id}/compliance-roadmap", response_model=ComplianceRoadmapOut)
async def patch_compliance_roadmap(workspace_id: str, body: ComplianceRoadmapPayload, request: Request):
    _require_invariant_or_admin(request)
    from routers.documents import _ensure_workspace

    _ensure_workspace(workspace_id)
    data = _normalize_payload(body)
    write_json_blob(_roadmap_blob_path(workspace_id), data)
    phases = [RoadmapPhaseModel(**p) for p in data["phases"]]
    return ComplianceRoadmapOut(phases=phases, updated_at=data.get("updated_at"))
