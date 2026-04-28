from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.models.seed_records import NormalizedSeedRecord

NPM_MIN_SEARCH_ELIGIBLE_RANK = 100
NPM_MIN_SEARCH_ELIGIBLE_SCORE = 250.0
NPM_EXCLUDED_DESCRIPTION_PHRASES = ("typo",)


class CorpusPolicy(Protocol):
    def is_search_eligible(self, record: NormalizedSeedRecord) -> bool: ...


@dataclass(frozen=True)
class DefaultCorpusPolicy:
    def is_search_eligible(self, record: NormalizedSeedRecord) -> bool:
        del record
        return True


@dataclass(frozen=True)
class NpmCorpusPolicy:
    def is_search_eligible(self, record: NormalizedSeedRecord) -> bool:
        score_final_raw = record.popularity_signal.get("score_final")
        score_final = (
            float(score_final_raw)
            if isinstance(score_final_raw, int | float)
            else None
        )
        rank_ok = (
            record.source_rank is not None
            and record.source_rank <= NPM_MIN_SEARCH_ELIGIBLE_RANK
        )
        score_ok = (
            score_final is not None and score_final >= NPM_MIN_SEARCH_ELIGIBLE_SCORE
        )
        description = (record.description or "").strip().lower()
        has_excluded_phrase = any(
            phrase in description for phrase in NPM_EXCLUDED_DESCRIPTION_PHRASES
        )
        return (rank_ok or score_ok) and not has_excluded_phrase


DEFAULT_CORPUS_POLICY = DefaultCorpusPolicy()
CORPUS_POLICIES: dict[str, CorpusPolicy] = {
    "npm": NpmCorpusPolicy(),
}


def get_corpus_policy(ecosystem: str) -> CorpusPolicy:
    return CORPUS_POLICIES.get(ecosystem, DEFAULT_CORPUS_POLICY)


def is_search_eligible(record: NormalizedSeedRecord) -> bool:
    return get_corpus_policy(record.ecosystem).is_search_eligible(record)
