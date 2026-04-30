from __future__ import annotations

from dataclasses import dataclass, field

from app.checks.embeddings import EmbeddingClient
from app.services.cached_embeddings import CachedEmbeddingClient


@dataclass
class FakeBaseEmbeddingClient(EmbeddingClient):
    calls: list[str] = field(default_factory=list)

    def embed_query(self, text: str) -> list[float]:
        self.calls.append(text)
        return [0.1, 0.2, 0.3]


@dataclass
class FakeCheckQueryEmbeddingRepository:
    cached_by_hash: dict[str, list[float]] = field(default_factory=dict)
    recorded_hashes: list[str] = field(default_factory=list)
    bumped_hashes: list[str] = field(default_factory=list)

    def fetch_embedding(
        self,
        *,
        embedding_model: str,
        request_hash: str,
    ) -> list[float] | None:
        del embedding_model
        return self.cached_by_hash.get(request_hash)

    def record_embedding(
        self,
        *,
        embedding_model: str,
        request_hash: str,
        ecosystem: str,
        package: str,
        description: str | None,
        request_text: str,
        embedding: list[float],
    ) -> None:
        del embedding_model, ecosystem, package, description, request_text
        self.recorded_hashes.append(request_hash)
        self.cached_by_hash[request_hash] = embedding

    def bump_hit_count(
        self,
        *,
        embedding_model: str,
        request_hash: str,
    ) -> None:
        del embedding_model
        self.bumped_hashes.append(request_hash)


def test_cached_embedding_client_reuses_cached_query_embedding() -> None:
    repository = FakeCheckQueryEmbeddingRepository()
    base_client = FakeBaseEmbeddingClient()
    client = CachedEmbeddingClient(
        embedding_model="openai/text-embedding-3-small",
        base_client=base_client,
        query_embeddings=repository,
        ecosystem="npm",
        package="react",
        description="React UI library",
    )

    first = client.embed_query("npm: react - React UI library")
    second = client.embed_query("npm: react - React UI library")

    assert first == [0.1, 0.2, 0.3]
    assert second == [0.1, 0.2, 0.3]
    assert base_client.calls == ["npm: react - React UI library"]
    assert len(repository.recorded_hashes) == 1
    assert len(repository.bumped_hashes) == 1
    assert repository.recorded_hashes[0] == repository.bumped_hashes[0]
