from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

MAX_PACKAGE_NAME_LENGTH = 256
MAX_PACKAGE_DESCRIPTION_LENGTH = 4096


class CheckRequest(BaseModel):
    ecosystem: Literal["npm", "pypi"]
    package: str = Field(min_length=1, max_length=MAX_PACKAGE_NAME_LENGTH)
    description: str | None = Field(
        default=None,
        max_length=MAX_PACKAGE_DESCRIPTION_LENGTH,
    )


class Neighbor(BaseModel):
    package: str
    description: str | None = None
    similarity_score: float
    source_rank: int | None = None
    source_score_final: float | None = None
    search_eligible: bool | None = None


class CheckMetadata(BaseModel):
    similarity_score: float | None
    lexical_similarity_score: float | None
    candidate_source_rank: int | None
    candidate_score_final: float | None
    candidate_trust: Literal["low", "medium", "high"] | None
    adjacent_name_found_in_corpus: bool
    stage_timings_ms: dict[str, int] | None = None
    judge_cache_hit: bool | None = None


class CheckResponse(BaseModel):
    is_suspicious: bool
    nearest_match: str | None
    match_quality: Literal["weak", "ambiguous", "strong"]
    recommended_action: Literal["allow", "review", "block"]
    llm_verdict: str | None
    confidence: Literal["low", "medium", "high"]
    latency_ms: int
    source: Literal["stub", "vector_search"]
    metadata: CheckMetadata


class SeedRequest(BaseModel):
    ecosystem: Literal["npm", "pypi"]
    limit: int = Field(default=500, ge=1, le=10000)
    dry_run: bool = True


class SeedResponse(BaseModel):
    ecosystem: Literal["npm", "pypi"]
    queued: bool
    processed_count: int
    source: Literal["stub"]
    message: str
