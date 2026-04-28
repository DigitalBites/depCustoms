from __future__ import annotations

import logging
from dataclasses import dataclass

from .checks.embeddings import OpenAIEmbeddingClient, StubEmbeddingClient
from .checks.graph import GraphServices, StubJudge, build_check_graph
from .checks.judge import CachedJudge, OpenAIJudge
from .core.config import Settings
from .core.db import IntelligenceDatabase
from .core.errors import OPENAI_PROVIDER_ERRORS, map_openai_error
from .core.internal_auth import InternalRequestAuthorizer, InternalTokenVerifier
from .core.limits import CheckRequestLimiter
from .schemas import Neighbor
from .services.neighbor_search import PgVectorNeighborSearcher
from .testing import StubNeighborSearcher

logger: logging.Logger = logging.getLogger("uvicorn.error")


@dataclass(frozen=True)
class AppRuntime:
    settings: Settings
    services: GraphServices
    check_graph: object
    request_authorizer: InternalRequestAuthorizer
    check_limiter: CheckRequestLimiter


def configure_logging(settings: Settings) -> None:
    level_name = settings.log_level.strip().upper()
    level = getattr(logging, level_name, logging.INFO)
    logger.setLevel(level)
    logger.propagate = True


def build_services(settings: Settings) -> GraphServices:
    if settings.stub_mode:
        return GraphServices(
            embeddings=StubEmbeddingClient(),
            neighbor_searcher=StubNeighborSearcher(),
            judge=StubJudge(
                similarity_high_threshold=settings.similarity_high_threshold
            ),
            settings=settings,
            source="stub",
        )

    database = IntelligenceDatabase.from_settings(settings)
    package_embeddings = database.package_embeddings()
    base_judge = OpenAIJudge.from_settings(settings)
    return GraphServices(
        embeddings=OpenAIEmbeddingClient.from_settings(settings),
        neighbor_searcher=PgVectorNeighborSearcher(
            package_embeddings=package_embeddings
        ),
        judge=CachedJudge(
            judge_model=settings.judge_model,
            base_judge=base_judge,
            judge_results=database.check_judge_results(),
        ),
        settings=settings,
        source="vector_search",
        embedding_model=settings.embedding_model,
        query_embeddings=database.check_query_embeddings(),
        package_embeddings=package_embeddings,
    )


def build_runtime(settings: Settings) -> AppRuntime:
    services = build_services(settings)
    return AppRuntime(
        settings=settings,
        services=services,
        check_graph=build_check_graph(services),
        request_authorizer=InternalRequestAuthorizer(InternalTokenVerifier(settings)),
        check_limiter=CheckRequestLimiter(
            max_requests_per_minute=settings.check_requests_per_minute,
            max_concurrent_requests=settings.check_concurrency_limit,
        ),
    )


def prewarm_services(services: GraphServices) -> None:
    if services.source == "stub":
        return

    try:
        services.embeddings.embed_query("npm: react - React UI library")
    except OPENAI_PROVIDER_ERRORS as exc:
        mapped_error = map_openai_error(exc)
        logger.warning(
            "embedding_prewarm_failed",
            extra={
                "code": mapped_error.code,
                "detail": mapped_error.detail,
            },
        )
    except Exception:
        logger.exception("embedding_prewarm_failed")

    try:
        services.judge.judge(
            ecosystem="npm",
            package="recat",
            description="React UI library",
            neighbors=[
                Neighbor(
                    package="react",
                    description=(
                        "React is a JavaScript library for building user interfaces."
                    ),
                    similarity_score=0.8,
                    source_rank=1,
                    source_score_final=2314.9753,
                    search_eligible=True,
                )
            ],
        )
    except OPENAI_PROVIDER_ERRORS as exc:
        mapped_error = map_openai_error(exc)
        logger.warning(
            "judge_prewarm_failed",
            extra={
                "code": mapped_error.code,
                "detail": mapped_error.detail,
            },
        )
    except Exception:
        logger.exception("judge_prewarm_failed")
