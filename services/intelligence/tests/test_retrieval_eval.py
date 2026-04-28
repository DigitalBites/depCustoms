from __future__ import annotations

import pytest

from app.evaluation.retrieval import (
    EvaluatedNeighbor,
    cosine_similarity,
    select_candidate,
)


def _entry(
    *,
    package: str,
    embedding: list[float],
    source_rank: int | None,
    source_score_final: float | None,
    search_eligible: bool = True,
) -> EvaluatedNeighbor:
    return EvaluatedNeighbor(
        ecosystem="npm",
        package=package,
        description=None,
        embedding=embedding,
        similarity_score=0.0,
        source_rank=source_rank,
        source_score_final=source_score_final,
        search_eligible=search_eligible,
    )


def test_cosine_similarity_returns_one_for_identical_vectors() -> None:
    assert cosine_similarity([1.0, 2.0], [1.0, 2.0]) == pytest.approx(1.0)


def test_select_candidate_short_circuits_on_exact_match() -> None:
    exact_match = _entry(
        package="preact",
        embedding=[],
        source_rank=229,
        source_score_final=149.18767,
        search_eligible=False,
    )

    result = select_candidate(
        package="preact",
        exact_match=exact_match,
        query_embedding=None,
        corpus=[],
        top_k=5,
    )

    assert result.nearest_match == "preact"
    assert result.source == "exact_match"
    assert result.similarity_score == 1.0
    assert result.lexical_score == 1.0


def test_select_candidate_reranks_toward_canonical_lexical_match() -> None:
    result = select_candidate(
        package="lodahs",
        exact_match=None,
        query_embedding=[1.0, 0.0],
        corpus=[
            _entry(
                package="@exodus/lodash",
                embedding=[1.0, 0.0],
                source_rank=197,
                source_score_final=293.31396,
            ),
            _entry(
                package="lodash",
                embedding=[0.9, 0.0],
                source_rank=1,
                source_score_final=2765.1655,
            ),
        ],
        top_k=5,
    )

    assert result.nearest_match == "lodash"
    assert result.source == "vector_search"
    assert result.candidate_trust == "high"
