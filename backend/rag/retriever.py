from __future__ import annotations

from collections import OrderedDict

from rag.chroma_store import get_store
from rag.embedder import embed_texts
from rag.types import RagHit


def retrieve(workspace_id: str, query: str, *, top_k: int = 6, paths: list[str] | None = None) -> list[RagHit]:
    query_embedding = embed_texts([query])[0]
    hits = get_store().query(workspace_id, query_embedding, top_k=top_k, paths=paths)
    return [hit for hit in hits if hit.text.strip()]


def source_paths(hits: list[RagHit], limit: int = 5) -> list[str]:
    ordered: OrderedDict[str, None] = OrderedDict()
    for hit in hits:
        if hit.path:
            ordered[hit.path.lstrip("/")] = None
        if len(ordered) >= limit:
            break
    return list(ordered.keys())


def citations_text(hits: list[RagHit]) -> str:
    paths = source_paths(hits)
    if not paths:
        return ""
    return "\n\nSources:\n" + "\n".join(f"Source: {path}" for path in paths)

