from app.checks.embeddings import StubEmbeddingClient, build_embedding_text
from app.checks.graph import (
    GraphServices,
    NeighborSearcher,
    StubJudge,
    build_check_graph,
    rerank_neighbors,
)
from app.checks.heuristics import (
    candidate_trust_band,
    match_quality,
    recommended_action,
)
from app.core.config import Settings
from app.schemas import Neighbor


class FakeNeighborSearcher(NeighborSearcher):
    def __init__(self, neighbors: list[Neighbor]) -> None:
        self._neighbors = neighbors

    def search(
        self, ecosystem: str, embedding: list[float], top_k: int
    ) -> list[Neighbor]:
        del ecosystem, embedding
        return self._neighbors[:top_k]


class FakePackageEmbeddings:
    def __init__(
        self,
        exact_match: Neighbor | None = None,
        lexical_candidates: list[Neighbor] | None = None,
    ) -> None:
        self._exact_match = exact_match
        self._lexical_candidates = lexical_candidates or []

    def find_exact_package(
        self,
        *,
        ecosystem: str,
        package: str,
    ) -> Neighbor | None:
        del ecosystem, package
        return self._exact_match

    def has_adjacent_name_in_corpus(
        self,
        *,
        ecosystem: str,
        package: str,
        exclude_package: str | None = None,
    ) -> bool:
        del ecosystem, package, exclude_package
        return False

    def search_lexical_candidates(
        self,
        *,
        ecosystem: str,
        package: str,
        embedding: list[float],
        top_k: int,
    ) -> list[Neighbor]:
        del ecosystem, package, embedding
        return self._lexical_candidates[:top_k]


def test_build_embedding_text_uses_description_when_present() -> None:
    assert (
        build_embedding_text("npm", "lodash", "Utility library")
        == "npm: lodash - Utility library"
    )


def test_graph_passes_when_no_neighbors_found() -> None:
    services = GraphServices(
        embeddings=StubEmbeddingClient(),
        neighbor_searcher=FakeNeighborSearcher([]),
        judge=StubJudge(similarity_high_threshold=0.97),
        settings=Settings(),
        source="stub",
        package_embeddings=FakePackageEmbeddings(),
    )
    graph = build_check_graph(services)

    result = graph.invoke({"ecosystem": "npm", "package": "lodahs"})

    assert result["verdict"]["is_suspicious"] is False
    assert result["verdict"]["nearest_match"] is None
    assert result["verdict"]["metadata"]["lexical_similarity_score"] is None
    assert result["verdict"]["metadata"]["candidate_trust"] is None
    assert result["verdict"]["recommended_action"] == "allow"


def test_graph_flags_on_direct_similarity_threshold() -> None:
    services = GraphServices(
        embeddings=StubEmbeddingClient(),
        neighbor_searcher=FakeNeighborSearcher(
            [
                Neighbor(
                    package="lodash",
                    description="Utility library",
                    similarity_score=0.99,
                )
            ]
        ),
        judge=StubJudge(similarity_high_threshold=0.97),
        settings=Settings(),
        source="stub",
        package_embeddings=FakePackageEmbeddings(),
    )
    graph = build_check_graph(services)

    result = graph.invoke({"ecosystem": "npm", "package": "lodahs"})

    assert result["verdict"]["is_suspicious"] is True
    assert result["verdict"]["confidence"] == "high"
    assert result["verdict"]["metadata"]["lexical_similarity_score"] is not None


def test_graph_uses_judge_in_ambiguous_band() -> None:
    services = GraphServices(
        embeddings=StubEmbeddingClient(),
        neighbor_searcher=FakeNeighborSearcher(
            [
                Neighbor(
                    package="requests",
                    description="HTTP library",
                    similarity_score=0.90,
                )
            ]
        ),
        judge=StubJudge(similarity_high_threshold=0.97),
        settings=Settings(),
        source="stub",
        package_embeddings=FakePackageEmbeddings(),
    )
    graph = build_check_graph(services)

    result = graph.invoke({"ecosystem": "pypi", "package": "requersts"})

    assert result["verdict"]["is_suspicious"] is True
    assert result["verdict"]["nearest_match"] == "requests"
    assert result["verdict"]["metadata"]["lexical_similarity_score"] is not None


def test_graph_uses_judge_for_lexical_typo_even_below_similarity_threshold() -> None:
    services = GraphServices(
        embeddings=StubEmbeddingClient(),
        neighbor_searcher=FakeNeighborSearcher(
            [
                Neighbor(
                    package="react",
                    description="UI library",
                    similarity_score=0.74,
                )
            ]
        ),
        judge=StubJudge(similarity_high_threshold=0.97),
        settings=Settings(),
        source="stub",
        package_embeddings=FakePackageEmbeddings(),
    )
    graph = build_check_graph(services)

    result = graph.invoke({"ecosystem": "npm", "package": "recat"})

    assert result["verdict"]["is_suspicious"] is True
    assert result["verdict"]["nearest_match"] == "react"
    assert result["verdict"]["metadata"]["lexical_similarity_score"] is not None


def test_graph_bypasses_judge_for_high_trust_strong_lexical_match() -> None:
    services = GraphServices(
        embeddings=StubEmbeddingClient(),
        neighbor_searcher=FakeNeighborSearcher(
            [
                Neighbor(
                    package="react",
                    description="UI library",
                    similarity_score=0.74,
                    source_rank=1,
                    source_score_final=2314.9753,
                )
            ]
        ),
        judge=StubJudge(similarity_high_threshold=0.97),
        settings=Settings(),
        source="stub",
        package_embeddings=FakePackageEmbeddings(),
    )
    graph = build_check_graph(services)

    result = graph.invoke({"ecosystem": "npm", "package": "recat"})

    assert result["verdict"]["is_suspicious"] is True
    assert result["verdict"]["nearest_match"] == "react"
    assert (
        result["verdict"]["llm_verdict"]
        == "Similarity exceeded the direct-flag threshold."
    )
    assert result["verdict"]["metadata"]["judge_cache_hit"] is None


def test_candidate_trust_band_prefers_high_rank_or_score() -> None:
    assert candidate_trust_band(source_rank=1, source_score_final=10.0) == "high"
    assert candidate_trust_band(source_rank=250, source_score_final=2000.0) == "high"
    assert candidate_trust_band(source_rank=50, source_score_final=100.0) == "medium"
    assert candidate_trust_band(source_rank=250, source_score_final=300.0) == "medium"
    assert candidate_trust_band(source_rank=250, source_score_final=100.0) == "low"
    assert candidate_trust_band(source_rank=None, source_score_final=None) is None


def test_graph_short_circuits_on_exact_package_match() -> None:
    services = GraphServices(
        embeddings=StubEmbeddingClient(),
        neighbor_searcher=FakeNeighborSearcher([]),
        judge=StubJudge(similarity_high_threshold=0.97),
        settings=Settings(),
        source="stub",
        package_embeddings=FakePackageEmbeddings(
            exact_match=Neighbor(
                package="preact",
                description="Fast 3kb React-compatible Virtual DOM library.",
                similarity_score=1.0,
                source_rank=229,
                source_score_final=149.18767,
                search_eligible=False,
            )
        ),
    )
    graph = build_check_graph(services)

    result = graph.invoke({"ecosystem": "npm", "package": "preact"})

    assert result["verdict"]["is_suspicious"] is False
    assert result["verdict"]["nearest_match"] == "preact"
    assert result["verdict"]["recommended_action"] == "allow"


def test_graph_short_circuits_on_non_eligible_exact_match() -> None:
    services = GraphServices(
        embeddings=StubEmbeddingClient(),
        neighbor_searcher=FakeNeighborSearcher(
            [
                Neighbor(
                    package="express",
                    description="Web framework",
                    similarity_score=0.92,
                    source_rank=1,
                    source_score_final=2244.7415,
                    search_eligible=True,
                )
            ]
        ),
        judge=StubJudge(similarity_high_threshold=0.97),
        settings=Settings(),
        source="stub",
        package_embeddings=FakePackageEmbeddings(
            exact_match=Neighbor(
                package="expres",
                description="Utility package",
                similarity_score=1.0,
                source_rank=16,
                source_score_final=143.80507,
                search_eligible=False,
            )
        ),
    )
    graph = build_check_graph(services)

    result = graph.invoke(
        {
            "ecosystem": "npm",
            "package": "expres",
            "description": "Fast, unopinionated, minimalist web framework",
        }
    )

    assert result["verdict"]["nearest_match"] == "expres"
    assert result["verdict"]["is_suspicious"] is False
    assert result["verdict"]["recommended_action"] == "allow"


def test_match_quality_and_recommended_action() -> None:
    assert (
        match_quality(
            is_exact_match=False,
            lexical_similarity=0.8,
            candidate_trust="high",
            adjacent_name_found_in_corpus=False,
        )
        == "strong"
    )
    assert (
        match_quality(
            is_exact_match=False,
            lexical_similarity=0.8,
            candidate_trust="low",
            adjacent_name_found_in_corpus=True,
        )
        == "ambiguous"
    )
    assert (
        match_quality(
            is_exact_match=False,
            lexical_similarity=0.6,
            candidate_trust="medium",
            adjacent_name_found_in_corpus=False,
        )
        == "weak"
    )
    assert (
        match_quality(
            is_exact_match=True,
            lexical_similarity=1.0,
            candidate_trust="low",
            adjacent_name_found_in_corpus=False,
        )
        == "strong"
    )
    assert (
        recommended_action(is_suspicious=False, match_quality_value="strong")
        == "allow"
    )
    assert (
        recommended_action(is_suspicious=True, match_quality_value="strong")
        == "block"
    )
    assert (
        recommended_action(is_suspicious=True, match_quality_value="ambiguous")
        == "review"
    )


def test_rerank_neighbors_prefers_canonical_lexical_match() -> None:
    reranked = rerank_neighbors(
        "lodahs",
        [
            Neighbor(
                package="@exodus/lodash",
                description="Exodus lodash helpers",
                similarity_score=0.667738,
                source_rank=197,
                source_score_final=293.31396,
            ),
            Neighbor(
                package="lodash",
                description="Lodash modular utilities.",
                similarity_score=0.62,
                source_rank=1,
                source_score_final=2765.1655,
            ),
        ],
    )

    assert reranked[0].package == "lodash"


def test_graph_merges_lexical_candidates_with_semantic_candidates() -> None:
    services = GraphServices(
        embeddings=StubEmbeddingClient(),
        neighbor_searcher=FakeNeighborSearcher(
            [
                Neighbor(
                    package="@exodus/lodash",
                    description="Exodus lodash helpers",
                    similarity_score=0.667738,
                    source_rank=197,
                    source_score_final=293.31396,
                )
            ]
        ),
        judge=StubJudge(similarity_high_threshold=0.97),
        settings=Settings(),
        source="stub",
        package_embeddings=FakePackageEmbeddings(
            lexical_candidates=[
                Neighbor(
                    package="lodash",
                    description="Lodash modular utilities.",
                    similarity_score=0.62,
                    source_rank=1,
                    source_score_final=2765.1655,
                )
            ]
        ),
    )
    graph = build_check_graph(services)

    result = graph.invoke(
        {
            "ecosystem": "npm",
            "package": "lodahs",
            "description": "Utility library",
        }
    )

    assert result["verdict"]["nearest_match"] == "lodash"


def test_rerank_neighbors_prefers_exact_match() -> None:
    reranked = rerank_neighbors(
        "preact",
        [
            Neighbor(
                package="jest-preset-preact",
                description="Jest preset for preact",
                similarity_score=0.708598,
                source_rank=216,
                source_score_final=272.50467,
            ),
            Neighbor(
                package="preact",
                description="Fast 3kb React-compatible Virtual DOM library.",
                similarity_score=0.60,
                source_rank=229,
                source_score_final=149.18767,
            ),
        ],
    )

    assert reranked[0].package == "preact"
