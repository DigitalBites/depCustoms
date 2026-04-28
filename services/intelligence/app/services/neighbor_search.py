from __future__ import annotations

from dataclasses import dataclass

from app.repositories.package_embeddings import PackageEmbeddingRepository
from app.schemas import Neighbor


@dataclass
class PgVectorNeighborSearcher:
    package_embeddings: PackageEmbeddingRepository

    def search(
        self,
        ecosystem: str,
        embedding: list[float],
        top_k: int,
    ) -> list[Neighbor]:
        return self.package_embeddings.search_neighbors(
            ecosystem=ecosystem,
            embedding=embedding,
            top_k=top_k,
        )
