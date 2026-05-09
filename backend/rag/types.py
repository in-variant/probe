from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RagChunk:
    workspace_id: str
    path: str
    chunk_id: str
    content_hash: str
    chunk_index: int
    text: str
    metadata: dict[str, Any]


@dataclass(frozen=True)
class RagHit:
    workspace_id: str
    path: str
    chunk_id: str
    chunk_index: int
    text: str
    score: float
    metadata: dict[str, Any]


@dataclass(frozen=True)
class IndexResult:
    workspace_id: str
    path: str
    status: str
    chunk_count: int
    error: str | None = None

