from __future__ import annotations

import hashlib
from dataclasses import dataclass

from app.checks.embeddings import EmbeddingClient
from app.repositories.check_query_embeddings import CheckQueryEmbeddingRepository


def hash_embedding_request_text(embedding_model: str, text: str) -> str:
    payload = f"{embedding_model}\n{text}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@dataclass
class CachedEmbeddingClient(EmbeddingClient):
    embedding_model: str
    base_client: EmbeddingClient
    query_embeddings: CheckQueryEmbeddingRepository
    ecosystem: str
    package: str
    description: str | None

    def embed_query(self, text: str) -> list[float]:
        request_hash = hash_embedding_request_text(self.embedding_model, text)
        cached_embedding = self.query_embeddings.fetch_embedding(
            embedding_model=self.embedding_model,
            request_hash=request_hash,
        )
        if cached_embedding is not None:
            self.query_embeddings.bump_hit_count(
                embedding_model=self.embedding_model,
                request_hash=request_hash,
            )
            return cached_embedding

        embedding = self.base_client.embed_query(text)
        self.query_embeddings.record_embedding(
            embedding_model=self.embedding_model,
            request_hash=request_hash,
            ecosystem=self.ecosystem,
            package=self.package,
            description=self.description,
            request_text=text,
            embedding=embedding,
        )
        return embedding
