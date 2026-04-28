from __future__ import annotations

from dataclasses import dataclass

from app.checks.graph import NeighborSearcher
from app.schemas import Neighbor


@dataclass
class StubNeighborSearcher(NeighborSearcher):
    def search(
        self,
        ecosystem: str,
        embedding: list[float],
        top_k: int,
    ) -> list[Neighbor]:
        del embedding
        candidates = {
            "npm": [
                Neighbor(
                    package="lodash",
                    description="Utility library",
                    similarity_score=0.94,
                ),
                Neighbor(
                    package="react",
                    description="UI library",
                    similarity_score=0.88,
                ),
            ],
            "pypi": [
                Neighbor(
                    package="requests",
                    description="HTTP client library",
                    similarity_score=0.93,
                ),
                Neighbor(
                    package="django",
                    description="Web framework",
                    similarity_score=0.84,
                ),
            ],
        }
        return candidates.get(ecosystem, [])[:top_k]
