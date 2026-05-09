from __future__ import annotations

import hashlib
import re

from rag.types import RagChunk


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def chunk_id(workspace_id: str, path: str, chunk_index: int, file_hash: str) -> str:
    raw = f"{workspace_id}:{path}:{chunk_index}:{file_hash}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def split_text(text: str, *, max_chars: int = 1800, overlap: int = 220) -> list[str]:
    normalized = re.sub(r"\n{3,}", "\n\n", text.strip())
    if not normalized:
        return []

    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(start + max_chars, len(normalized))
        window = normalized[start:end]
        if end < len(normalized):
            split_at = max(window.rfind("\n\n"), window.rfind(". "), window.rfind("\n"))
            if split_at > max_chars * 0.45:
                end = start + split_at + 1
                window = normalized[start:end]
        chunks.append(window.strip())
        if end >= len(normalized):
            break
        start = max(0, end - overlap)
    return [c for c in chunks if c]


def build_chunks(workspace_id: str, path: str, text: str) -> list[RagChunk]:
    file_hash = content_hash(text)
    parts = split_text(text)
    return [
        RagChunk(
            workspace_id=workspace_id,
            path=path,
            chunk_id=chunk_id(workspace_id, path, idx, file_hash),
            content_hash=file_hash,
            chunk_index=idx,
            text=part,
            metadata={
                "workspace_id": workspace_id,
                "path": path,
                "chunk_index": idx,
                "content_hash": file_hash,
                "char_count": len(part),
            },
        )
        for idx, part in enumerate(parts)
    ]

