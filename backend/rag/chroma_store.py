from __future__ import annotations

import logging
import os
import re
from pathlib import Path

import chromadb

from rag.types import RagChunk, RagHit

logger = logging.getLogger(__name__)

DEFAULT_CHROMA_DIR = Path(os.getenv("RAG_CHROMA_DIR", "/tmp/probe-rag/chroma"))


def collection_name(workspace_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", workspace_id.strip()).strip("_-")[:57]
    return f"probe_{safe or 'workspace'}"


class ChromaStore:
    def __init__(self, persist_dir: Path | None = None):
        self.persist_dir = persist_dir or DEFAULT_CHROMA_DIR
        self.persist_dir.mkdir(parents=True, exist_ok=True)
        self.client = chromadb.PersistentClient(path=str(self.persist_dir))

    def collection(self, workspace_id: str):
        return self.client.get_or_create_collection(
            name=collection_name(workspace_id),
            metadata={"hnsw:space": "cosine"},
        )

    def upsert_chunks(self, workspace_id: str, chunks: list[RagChunk], embeddings: list[list[float]]) -> None:
        if not chunks:
            return
        collection = self.collection(workspace_id)
        collection.upsert(
            ids=[c.chunk_id for c in chunks],
            documents=[c.text for c in chunks],
            embeddings=embeddings,
            metadatas=[c.metadata for c in chunks],
        )
        logger.info(
            "rag_upsert_chunks workspace=%s paths=%s chunks=%s",
            workspace_id,
            len({c.path for c in chunks}),
            len(chunks),
        )

    def delete_path(self, workspace_id: str, path: str) -> None:
        collection = self.collection(workspace_id)
        collection.delete(where={"path": path})
        logger.info("rag_delete_path workspace=%s path=%s", workspace_id, path)

    def query(
        self,
        workspace_id: str,
        query_embedding: list[float],
        *,
        top_k: int = 6,
        paths: list[str] | None = None,
    ) -> list[RagHit]:
        collection = self.collection(workspace_id)
        where = {"path": {"$in": paths}} if paths else None
        result = collection.query(
            query_embeddings=[query_embedding],
            n_results=max(1, min(top_k, 20)),
            where=where,
            include=["documents", "metadatas", "distances"],
        )
        docs = result.get("documents", [[]])[0]
        metas = result.get("metadatas", [[]])[0]
        ids = result.get("ids", [[]])[0]
        distances = result.get("distances", [[]])[0]
        hits: list[RagHit] = []
        for idx, doc in enumerate(docs):
            meta = metas[idx] or {}
            distance = float(distances[idx]) if idx < len(distances) else 1.0
            hits.append(
                RagHit(
                    workspace_id=str(meta.get("workspace_id", workspace_id)),
                    path=str(meta.get("path", "")),
                    chunk_id=str(ids[idx]),
                    chunk_index=int(meta.get("chunk_index", 0)),
                    text=doc or "",
                    score=max(0.0, 1.0 - distance),
                    metadata=dict(meta),
                )
            )
        logger.info("rag_query workspace=%s top_k=%s hits=%s", workspace_id, top_k, len(hits))
        return hits


_store: ChromaStore | None = None


def get_store() -> ChromaStore:
    global _store
    if _store is None:
        _store = ChromaStore()
    return _store


def set_store_for_tests(store: ChromaStore | None) -> None:
    global _store
    _store = store

