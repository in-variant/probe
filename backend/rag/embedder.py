from __future__ import annotations

import hashlib
import os
from functools import lru_cache

from openai import OpenAI

EMBED_MODEL = os.getenv("RAG_EMBED_MODEL", "text-embedding-3-small")
EMBED_DIM = int(os.getenv("RAG_EMBED_DIM", "1536"))


def _hash_embedding(text: str, dim: int = EMBED_DIM) -> list[float]:
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    values: list[float] = []
    seed = digest
    while len(values) < dim:
        seed = hashlib.sha256(seed).digest()
        for b in seed:
            values.append((b / 255.0) * 2.0 - 1.0)
            if len(values) >= dim:
                break
    norm = sum(v * v for v in values) ** 0.5 or 1.0
    return [v / norm for v in values]


@lru_cache(maxsize=1)
def _client() -> OpenAI:
    return OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key or api_key == "test-key":
        return [_hash_embedding(t) for t in texts]
    response = _client().embeddings.create(model=EMBED_MODEL, input=texts)
    return [item.embedding for item in response.data]

