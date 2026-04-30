from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter
from typing import Any, Literal, Protocol, TypedDict

from langgraph.graph import END, StateGraph

from ..core.config import Settings
from ..domain.package_names import lexical_similarity_score
from ..repositories.check_query_embeddings import CheckQueryEmbeddingRepository
from ..repositories.package_embeddings import PackageEmbeddingRepository
from ..schemas import Neighbor
from ..services.cached_embeddings import CachedEmbeddingClient
from .embeddings import EmbeddingClient, build_embedding_text
from .heuristics import (
    build_verdict,
    merge_candidate_sets,
    rerank_neighbors,
    route_after_search,
)
from .judge import JudgeDecision


class CheckState(TypedDict, total=False):
    ecosystem: str
    package: str
    description: str | None
    exact_match: Neighbor | None
    embedding: list[float]
    neighbors: list[Neighbor]
    lexical_similarity_score: float | None
    adjacent_name_found_in_corpus: bool
    judge_cache_hit: bool | None
    stage_timings_ms: dict[str, int]
    verdict: dict[str, Any]


class NeighborSearcher(Protocol):
    def search(
        self, ecosystem: str, embedding: list[float], top_k: int
    ) -> list[Neighbor]:
        ...


class Judge(Protocol):
    def judge(
        self,
        ecosystem: str,
        *,
        package: str,
        description: str | None,
        neighbors: list[Neighbor],
    ) -> JudgeDecision:
        ...


@dataclass
class StubJudge(Judge):
    similarity_high_threshold: float

    def judge(
        self,
        ecosystem: str,
        *,
        package: str,
        description: str | None,
        neighbors: list[Neighbor],
    ) -> JudgeDecision:
        del ecosystem, description
        neighbor = neighbors[0]
        if neighbor.similarity_score >= self.similarity_high_threshold:
            return JudgeDecision(
                suspicious=True,
                selected_match=neighbor.package,
                rationale=(
                    f"High confidence typosquat candidate near '{neighbor.package}'."
                ),
                confidence="high",
            )

        suspicious = package.replace("-", "") != neighbor.package.replace("-", "")
        if suspicious:
            return JudgeDecision(
                suspicious=True,
                selected_match=neighbor.package,
                rationale=(
                    f"Possible typosquat of '{neighbor.package}' based on "
                    "near-match naming."
                ),
                confidence="medium",
            )
        return JudgeDecision(
            suspicious=False,
            selected_match=neighbor.package,
            rationale="Nearest package appears related but not suspicious.",
            confidence="low",
        )


@dataclass
class GraphServices:
    embeddings: EmbeddingClient
    neighbor_searcher: NeighborSearcher
    judge: Judge
    settings: Settings
    source: Literal["stub", "vector_search"]
    embedding_model: str | None = None
    query_embeddings: CheckQueryEmbeddingRepository | None = None
    package_embeddings: PackageEmbeddingRepository | None = None


ExactMatchRoute = Literal["exact_pass", "embed_query"]
EXACT_MATCH_ROUTE_LABELS: dict[ExactMatchRoute, str] = {
    "exact_pass": "exact package exists in corpus",
    "embed_query": "no exact package",
}

SEARCH_ROUTE_LABELS: dict[str, str] = {
    "pass_empty": "no candidates",
    "pass_exact_top": "top candidate equals request",
    "flag_without_judge": "high trust + lexical >= 0.8",
    "judge": "typo-like but needs adjudication",
    "pass_default": "non-typo or weak signal",
}

CHECK_GRAPH_NODE_LABELS: dict[str, str] = {
    "exact_match_lookup": "exact_match_lookup",
    "embed_query": "embed_query",
    "candidate_search": "candidate_search<br/>semantic + lexical<br/>+ rerank",
    "exact_pass": "exact_pass",
    "pass": "pass",
    "flag_without_judge": "flag_without_judge",
    "llm_judge": "llm_judge",
}


def get_check_graph_labels() -> dict[str, dict[str, str]]:
    return {
        "nodes": CHECK_GRAPH_NODE_LABELS,
        "exact_match_routes": dict(EXACT_MATCH_ROUTE_LABELS),
        "search_routes": dict(SEARCH_ROUTE_LABELS),
    }


def embed_query(state: CheckState, services: GraphServices) -> CheckState:
    start = perf_counter()
    text = build_embedding_text(
        ecosystem=state["ecosystem"],
        package=state["package"],
        description=state.get("description"),
    )
    embedding_client: EmbeddingClient = services.embeddings
    if services.query_embeddings is not None and services.embedding_model is not None:
        embedding_client = CachedEmbeddingClient(
            embedding_model=services.embedding_model,
            base_client=services.embeddings,
            query_embeddings=services.query_embeddings,
            ecosystem=state["ecosystem"],
            package=state["package"],
            description=state.get("description"),
        )
    embedding = embedding_client.embed_query(text)
    elapsed_ms = int((perf_counter() - start) * 1000)
    return {
        "embedding": embedding,
        "stage_timings_ms": {
            **state.get("stage_timings_ms", {}),
            "embed_query": elapsed_ms,
        },
    }


def exact_match_lookup(state: CheckState, services: GraphServices) -> CheckState:
    start = perf_counter()
    if services.package_embeddings is None:
        exact_match = None
    else:
        exact_match = services.package_embeddings.find_exact_package(
            ecosystem=state["ecosystem"],
            package=state["package"],
        )
    elapsed_ms = int((perf_counter() - start) * 1000)
    return {
        "exact_match": exact_match,
        "stage_timings_ms": {
            **state.get("stage_timings_ms", {}),
            "exact_match_lookup": elapsed_ms,
        },
    }


def vector_search(state: CheckState, services: GraphServices) -> CheckState:
    start = perf_counter()
    semantic_neighbors = services.neighbor_searcher.search(
        ecosystem=state["ecosystem"],
        embedding=state["embedding"],
        top_k=services.settings.search_top_k,
    )
    lexical_neighbors: list[Neighbor] = []
    if services.package_embeddings is not None:
        lexical_neighbors = services.package_embeddings.search_lexical_candidates(
            ecosystem=state["ecosystem"],
            package=state["package"],
            embedding=state["embedding"],
            top_k=services.settings.search_top_k,
        )
    neighbors = merge_candidate_sets(semantic_neighbors, lexical_neighbors)
    reranked_neighbors = rerank_neighbors(state["package"], neighbors)
    top = reranked_neighbors[0] if reranked_neighbors else None
    return {
        "neighbors": reranked_neighbors,
        "lexical_similarity_score": (
            lexical_similarity_score(state["package"], top.package) if top else None
        ),
        "adjacent_name_found_in_corpus": (
            services.package_embeddings.has_adjacent_name_in_corpus(
                ecosystem=state["ecosystem"],
                package=state["package"],
                exclude_package=top.package,
            )
            if top is not None and services.package_embeddings is not None
            else False
        ),
        "stage_timings_ms": {
            **state.get("stage_timings_ms", {}),
            "candidate_search": int((perf_counter() - start) * 1000),
        },
    }


def route_after_exact_match(state: CheckState) -> ExactMatchRoute:
    if state.get("exact_match") is not None:
        return "exact_pass"
    return "embed_query"


def _build_verdict_from_neighbor(
    state: CheckState,
    services: GraphServices,
    *,
    neighbor: Neighbor | None,
    is_suspicious: bool,
    llm_verdict: str,
    confidence: Literal["low", "medium", "high"],
    is_exact_match: bool | None = None,
    lexical_score: float | None = None,
) -> dict[str, Any]:
    if is_exact_match is None:
        is_exact_match = neighbor.package == state["package"] if neighbor else False
    if lexical_score is None:
        lexical_score = (
            lexical_similarity_score(state["package"], neighbor.package)
            if neighbor
            else None
        )

    return build_verdict(
        is_suspicious=is_suspicious,
        is_exact_match=is_exact_match,
        nearest_match=neighbor.package if neighbor else None,
        similarity_score=neighbor.similarity_score if neighbor else None,
        lexical_similarity_score_value=lexical_score,
        candidate_source_rank=neighbor.source_rank if neighbor else None,
        candidate_score_final=neighbor.source_score_final if neighbor else None,
        adjacent_name_found_in_corpus=state.get("adjacent_name_found_in_corpus", False),
        stage_timings_ms=state.get("stage_timings_ms"),
        judge_cache_hit=state.get("judge_cache_hit"),
        llm_verdict=llm_verdict,
        confidence=confidence,
        source=services.source,
    )


def exact_pass_node(state: CheckState, services: GraphServices) -> CheckState:
    exact_match = state.get("exact_match")
    adjacent_name_found_in_corpus = (
        services.package_embeddings.has_adjacent_name_in_corpus(
            ecosystem=state["ecosystem"],
            package=state["package"],
            exclude_package=exact_match.package,
        )
        if exact_match is not None and services.package_embeddings is not None
        else False
    )
    return {
        "verdict": build_verdict(
            is_suspicious=False,
            is_exact_match=True,
            nearest_match=exact_match.package if exact_match else None,
            similarity_score=1.0 if exact_match else None,
            lexical_similarity_score_value=1.0 if exact_match else None,
            candidate_source_rank=exact_match.source_rank if exact_match else None,
            candidate_score_final=(
                exact_match.source_score_final if exact_match else None
            ),
            adjacent_name_found_in_corpus=adjacent_name_found_in_corpus,
            stage_timings_ms=state.get("stage_timings_ms"),
            judge_cache_hit=state.get("judge_cache_hit"),
            llm_verdict="Exact package name found in the stored corpus.",
            confidence="low",
            source=services.source,
        )
    }


def pass_node(state: CheckState, services: GraphServices) -> CheckState:
    neighbors = state.get("neighbors") or []
    top = neighbors[0] if neighbors else None
    return {
        "verdict": _build_verdict_from_neighbor(
            state,
            services,
            is_suspicious=False,
            neighbor=top,
            llm_verdict="No suspicious near-match found.",
            confidence="low",
            lexical_score=state.get("lexical_similarity_score"),
        )
    }


def flag_without_judge(state: CheckState, services: GraphServices) -> CheckState:
    top = (state.get("neighbors") or [None])[0]
    return {
        "verdict": _build_verdict_from_neighbor(
            state,
            services,
            is_suspicious=True,
            neighbor=top,
            llm_verdict="Similarity exceeded the direct-flag threshold.",
            confidence="high",
            lexical_score=state.get("lexical_similarity_score"),
        )
    }


def llm_judge_node(state: CheckState, services: GraphServices) -> CheckState:
    top = (state.get("neighbors") or [None])[0]
    if top is None:
        return pass_node(state, services)

    start = perf_counter()
    decision = services.judge.judge(
        ecosystem=state["ecosystem"],
        package=state["package"],
        description=state.get("description"),
        neighbors=(state.get("neighbors") or [])[:3],
    )
    elapsed_ms = int((perf_counter() - start) * 1000)
    selected_neighbor = next(
        (
            neighbor
            for neighbor in (state.get("neighbors") or [])
            if neighbor.package == decision.selected_match
        ),
        top,
    )
    return {
        "judge_cache_hit": decision.cached,
        "stage_timings_ms": {
            **state.get("stage_timings_ms", {}),
            "judge": elapsed_ms,
        },
        "verdict": _build_verdict_from_neighbor(
            {
                **state,
                "judge_cache_hit": decision.cached,
                "stage_timings_ms": {
                    **state.get("stage_timings_ms", {}),
                    "judge": elapsed_ms,
                },
            },
            services,
            is_suspicious=decision.suspicious,
            neighbor=selected_neighbor,
            llm_verdict=decision.rationale,
            confidence=decision.confidence,
        )
    }


def build_check_graph(services: GraphServices):
    graph = StateGraph(CheckState)
    graph.add_node(
        "exact_match_lookup",
        lambda state: exact_match_lookup(state, services),
    )
    graph.add_node("embed_query", lambda state: embed_query(state, services))
    graph.add_node("vector_search", lambda state: vector_search(state, services))
    graph.add_node("exact_pass", lambda state: exact_pass_node(state, services))
    graph.add_node("pass", lambda state: pass_node(state, services))
    graph.add_node(
        "flag_without_judge", lambda state: flag_without_judge(state, services)
    )
    graph.add_node("llm_judge", lambda state: llm_judge_node(state, services))

    graph.set_entry_point("exact_match_lookup")
    graph.add_conditional_edges(
        "exact_match_lookup",
        route_after_exact_match,
        {
            "exact_pass": "exact_pass",
            "embed_query": "embed_query",
        },
    )
    graph.add_edge("embed_query", "vector_search")
    graph.add_conditional_edges(
        "vector_search",
        lambda state: route_after_search(
            package=state["package"],
            neighbors=state.get("neighbors") or [],
            lexical_score=state.get("lexical_similarity_score"),
            similarity_low_threshold=services.settings.similarity_low_threshold,
            similarity_high_threshold=services.settings.similarity_high_threshold,
            judge_lexical_backstop_threshold=(
                services.settings.judge_lexical_backstop_threshold
            ),
        ),
        {
            "pass": "pass",
            "flag_without_judge": "flag_without_judge",
            "judge": "llm_judge",
        },
    )
    graph.add_edge("exact_pass", END)
    graph.add_edge("pass", END)
    graph.add_edge("flag_without_judge", END)
    graph.add_edge("llm_judge", END)
    return graph.compile()
