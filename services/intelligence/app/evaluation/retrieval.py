from __future__ import annotations

from dataclasses import dataclass
from math import sqrt
from typing import Literal

from app.checks.heuristics import candidate_trust_band, rerank_neighbors
from app.domain.package_names import lexical_similarity_score
from app.schemas import Neighbor


@dataclass(frozen=True)
class EvaluatedNeighbor:
    ecosystem: str
    package: str
    description: str | None
    embedding: list[float]
    similarity_score: float
    source_rank: int | None
    source_score_final: float | None
    search_eligible: bool

    def to_neighbor(self) -> Neighbor:
        return Neighbor(
            package=self.package,
            description=self.description,
            similarity_score=self.similarity_score,
            source_rank=self.source_rank,
            source_score_final=self.source_score_final,
            search_eligible=self.search_eligible,
        )


@dataclass(frozen=True)
class RetrievalSelection:
    nearest_match: str | None
    similarity_score: float | None
    lexical_score: float | None
    candidate_source_rank: int | None
    candidate_score_final: float | None
    candidate_trust: Literal["low", "medium", "high"] | None
    source: Literal["exact_match", "vector_search", "no_match"]


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if len(left) != len(right):
        raise ValueError("embedding vectors must have equal dimensions")
    numerator = sum(a * b for a, b in zip(left, right, strict=True))
    left_norm = sqrt(sum(a * a for a in left))
    right_norm = sqrt(sum(b * b for b in right))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return numerator / (left_norm * right_norm)


def select_candidate(
    *,
    package: str,
    exact_match: EvaluatedNeighbor | None,
    query_embedding: list[float] | None,
    corpus: list[EvaluatedNeighbor],
    top_k: int,
) -> RetrievalSelection:
    if exact_match is not None:
        return RetrievalSelection(
            nearest_match=exact_match.package,
            similarity_score=1.0,
            lexical_score=1.0,
            candidate_source_rank=exact_match.source_rank,
            candidate_score_final=exact_match.source_score_final,
            candidate_trust=candidate_trust_band(
                source_rank=exact_match.source_rank,
                source_score_final=exact_match.source_score_final,
            ),
            source="exact_match",
        )

    if query_embedding is None:
        return RetrievalSelection(
            nearest_match=None,
            similarity_score=None,
            lexical_score=None,
            candidate_source_rank=None,
            candidate_score_final=None,
            candidate_trust=None,
            source="no_match",
        )

    semantic_neighbors = sorted(
        corpus,
        key=lambda entry: cosine_similarity(query_embedding, entry.embedding),
        reverse=True,
    )[:top_k]
    reranked_neighbors = rerank_neighbors(
        package,
        [
            Neighbor(
                package=entry.package,
                description=entry.description,
                similarity_score=cosine_similarity(query_embedding, entry.embedding),
                source_rank=entry.source_rank,
                source_score_final=entry.source_score_final,
                search_eligible=entry.search_eligible,
            )
            for entry in semantic_neighbors
        ],
    )
    if not reranked_neighbors:
        return RetrievalSelection(
            nearest_match=None,
            similarity_score=None,
            lexical_score=None,
            candidate_source_rank=None,
            candidate_score_final=None,
            candidate_trust=None,
            source="no_match",
        )

    selected = reranked_neighbors[0]
    return RetrievalSelection(
        nearest_match=selected.package,
        similarity_score=selected.similarity_score,
        lexical_score=lexical_similarity_score(package, selected.package),
        candidate_source_rank=selected.source_rank,
        candidate_score_final=selected.source_score_final,
        candidate_trust=candidate_trust_band(
            source_rank=selected.source_rank,
            source_score_final=selected.source_score_final,
        ),
        source="vector_search",
    )
