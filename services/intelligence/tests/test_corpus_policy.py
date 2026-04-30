from __future__ import annotations

from datetime import UTC, datetime

from app.domain.corpus_policy import (
    DefaultCorpusPolicy,
    NpmCorpusPolicy,
    get_corpus_policy,
    is_search_eligible,
)
from app.models.seed_records import NormalizedSeedRecord


def build_record(
    *,
    package: str,
    description: str | None,
    source_rank: int | None,
    score_final: float | None,
    ecosystem: str = "npm",
) -> NormalizedSeedRecord:
    popularity_signal = {}
    if score_final is not None:
        popularity_signal["score_final"] = score_final
    return NormalizedSeedRecord(
        ecosystem=ecosystem,
        package=package,
        description=description,
        version="1.0.0",
        source="seed_npm" if ecosystem == "npm" else "seed_other",
        source_query=package,
        source_rank=source_rank,
        popularity_signal=popularity_signal,
        collected_at=datetime(2026, 4, 22, tzinfo=UTC),
        source_record_hash="a" * 64,
    )


def test_is_search_eligible_accepts_high_rank_npm_package() -> None:
    record = build_record(
        package="react",
        description="React is a JavaScript library for building user interfaces.",
        source_rank=1,
        score_final=2314.9753,
    )

    assert is_search_eligible(record) is True
    assert isinstance(get_corpus_policy("npm"), NpmCorpusPolicy)


def test_is_search_eligible_rejects_low_rank_typo_adjacent_npm_package() -> None:
    record = build_record(
        package="lodas",
        description="lodash typo helper",
        source_rank=243,
        score_final=134.272,
    )

    assert is_search_eligible(record) is False


def test_is_search_eligible_accepts_non_npm_by_default() -> None:
    record = build_record(
        ecosystem="pypi",
        package="requests",
        description="Python HTTP for Humans.",
        source_rank=None,
        score_final=None,
    )

    assert is_search_eligible(record) is True
    assert isinstance(get_corpus_policy("pypi"), DefaultCorpusPolicy)
