from __future__ import annotations

from typing import Any, Literal

from ..domain.package_names import lexical_similarity_score, looks_like_typo_variant
from ..schemas import Neighbor

SearchRoute = Literal["pass", "flag_without_judge", "judge"]


def candidate_trust_band(
    *, source_rank: int | None, source_score_final: float | None
) -> Literal["low", "medium", "high"] | None:
    if source_rank is None and source_score_final is None:
        return None
    if (
        source_rank is not None
        and source_rank <= 10
        or source_score_final is not None
        and source_score_final >= 1000
    ):
        return "high"
    if (
        source_rank is not None
        and source_rank <= 100
        or source_score_final is not None
        and source_score_final >= 250
    ):
        return "medium"
    return "low"


def rerank_score(package: str, neighbor: Neighbor) -> float:
    lexical = lexical_similarity_score(package, neighbor.package)
    trust = candidate_trust_band(
        source_rank=neighbor.source_rank,
        source_score_final=neighbor.source_score_final,
    )
    trust_bonus = {"high": 0.15, "medium": 0.075, "low": 0.0, None: 0.0}[trust]
    exact_bonus = 1.0 if lexical == 1.0 else 0.0
    return (
        (lexical * 0.65)
        + (neighbor.similarity_score * 0.2)
        + trust_bonus
        + exact_bonus
    )


def rerank_neighbors(package: str, neighbors: list[Neighbor]) -> list[Neighbor]:
    return sorted(
        neighbors,
        key=lambda neighbor: (
            rerank_score(package, neighbor),
            lexical_similarity_score(package, neighbor.package),
            neighbor.similarity_score,
        ),
        reverse=True,
    )


def merge_candidate_sets(*candidate_sets: list[Neighbor]) -> list[Neighbor]:
    by_package: dict[str, Neighbor] = {}
    for neighbors in candidate_sets:
        for neighbor in neighbors:
            current = by_package.get(neighbor.package)
            if current is None or neighbor.similarity_score > current.similarity_score:
                by_package[neighbor.package] = neighbor
    return list(by_package.values())


def match_quality(
    *,
    is_exact_match: bool,
    lexical_similarity: float | None,
    candidate_trust: Literal["low", "medium", "high"] | None,
    adjacent_name_found_in_corpus: bool,
) -> Literal["weak", "ambiguous", "strong"]:
    if is_exact_match:
        return "strong"
    if (
        candidate_trust == "high"
        and lexical_similarity is not None
        and lexical_similarity >= 0.8
    ):
        return "strong"
    if adjacent_name_found_in_corpus or candidate_trust == "low":
        return "ambiguous"
    return "weak"


def recommended_action(
    *,
    is_suspicious: bool,
    match_quality_value: Literal["weak", "ambiguous", "strong"],
) -> Literal["allow", "review", "block"]:
    if not is_suspicious:
        return "allow"
    if match_quality_value == "strong":
        return "block"
    return "review"


def build_verdict(
    *,
    is_suspicious: bool,
    is_exact_match: bool,
    nearest_match: str | None,
    similarity_score: float | None,
    lexical_similarity_score_value: float | None,
    candidate_source_rank: int | None,
    candidate_score_final: float | None,
    adjacent_name_found_in_corpus: bool,
    stage_timings_ms: dict[str, int] | None,
    judge_cache_hit: bool | None,
    llm_verdict: str,
    confidence: Literal["low", "medium", "high"],
    source: Literal["stub", "vector_search"],
) -> dict[str, Any]:
    candidate_trust = candidate_trust_band(
        source_rank=candidate_source_rank,
        source_score_final=candidate_score_final,
    )
    quality = match_quality(
        is_exact_match=is_exact_match,
        lexical_similarity=lexical_similarity_score_value,
        candidate_trust=candidate_trust,
        adjacent_name_found_in_corpus=adjacent_name_found_in_corpus,
    )
    return {
        "is_suspicious": is_suspicious,
        "nearest_match": nearest_match,
        "match_quality": quality,
        "recommended_action": recommended_action(
            is_suspicious=is_suspicious,
            match_quality_value=quality,
        ),
        "llm_verdict": llm_verdict,
        "confidence": confidence,
        "source": source,
        "metadata": {
            "similarity_score": similarity_score,
            "lexical_similarity_score": lexical_similarity_score_value,
            "candidate_source_rank": candidate_source_rank,
            "candidate_score_final": candidate_score_final,
            "candidate_trust": candidate_trust,
            "adjacent_name_found_in_corpus": adjacent_name_found_in_corpus,
            "stage_timings_ms": stage_timings_ms,
            "judge_cache_hit": judge_cache_hit,
        },
    }


def route_after_search(
    *,
    package: str,
    neighbors: list[Neighbor],
    lexical_score: float | None,
    similarity_low_threshold: float,
    similarity_high_threshold: float,
    judge_lexical_backstop_threshold: float,
) -> SearchRoute:
    if not neighbors:
        return "pass"

    top = neighbors[0]
    candidate_trust = candidate_trust_band(
        source_rank=top.source_rank,
        source_score_final=top.source_score_final,
    )
    if top.package == package:
        return "pass"
    if (
        candidate_trust == "high"
        and lexical_score is not None
        and lexical_score >= 0.8
    ):
        return "flag_without_judge"
    if looks_like_typo_variant(package, top.package):
        return "judge"
    if (
        lexical_score is not None
        and lexical_score >= judge_lexical_backstop_threshold
        and candidate_trust in {"medium", "high"}
    ):
        return "judge"
    if top.similarity_score < similarity_low_threshold:
        return "pass"
    if top.similarity_score >= similarity_high_threshold:
        return "flag_without_judge"
    return "judge"
