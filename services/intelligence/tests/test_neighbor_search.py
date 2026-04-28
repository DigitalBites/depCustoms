from __future__ import annotations

from dataclasses import dataclass

from app.schemas import Neighbor
from app.services.neighbor_search import PgVectorNeighborSearcher


@dataclass
class FakePackageEmbeddingRepository:
    last_ecosystem: str | None = None
    last_embedding: list[float] | None = None
    last_top_k: int | None = None

    def search_neighbors(
        self,
        ecosystem: str,
        embedding: list[float],
        top_k: int,
    ) -> list[Neighbor]:
        self.last_ecosystem = ecosystem
        self.last_embedding = embedding
        self.last_top_k = top_k
        return [
            Neighbor(
                package="lodash",
                description="Utility library",
                similarity_score=0.94,
            )
        ]


def test_pgvector_neighbor_searcher_delegates_to_repository() -> None:
    repository = FakePackageEmbeddingRepository()
    searcher = PgVectorNeighborSearcher(package_embeddings=repository)

    neighbors = searcher.search(
        ecosystem="npm",
        embedding=[0.1, 0.2, 0.3],
        top_k=5,
    )

    assert repository.last_ecosystem == "npm"
    assert repository.last_embedding == [0.1, 0.2, 0.3]
    assert repository.last_top_k == 5
    assert len(neighbors) == 1
    assert neighbors[0].package == "lodash"
