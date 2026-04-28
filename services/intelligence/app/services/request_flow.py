from __future__ import annotations

import json
import logging
from time import perf_counter
from typing import Any, Protocol

from fastapi import Request

from app.core.errors import OPENAI_PROVIDER_ERRORS, map_openai_error
from app.core.internal_auth import InternalRequestAuthorizer, VerifiedInternalRequest
from app.core.limits import CheckRequestLimiter
from app.schemas import CheckRequest, CheckResponse, SeedRequest, SeedResponse


class CheckGraph(Protocol):
    def invoke(self, state: dict[str, object]) -> dict[str, object]: ...


def handle_check_request(
    payload: CheckRequest,
    request: Request,
    *,
    authorizer: InternalRequestAuthorizer,
    check_graph: CheckGraph,
    check_limiter: CheckRequestLimiter,
    logger: logging.Logger,
) -> CheckResponse:
    verified_request = authorizer.authorize_request(
        request,
        required_capability="intelligence.check",
        require_tenant=True,
    )
    _log_request(
        logger,
        "intelligence_check_request",
        verified_request,
        {
            "ecosystem": payload.ecosystem,
            "package": payload.package.strip().lower(),
        },
    )
    limiter_key = f"{verified_request.service}:{verified_request.subject}"
    check_limiter.check_rate_limit(limiter_key)
    start = perf_counter()
    try:
        with check_limiter.acquire():
            state = check_graph.invoke(
                {
                    "ecosystem": payload.ecosystem,
                    "package": payload.package.strip().lower(),
                    "description": payload.description,
                }
            )
    except OPENAI_PROVIDER_ERRORS as exc:
        mapped_error = map_openai_error(exc)
        logger.warning(
            "openai_provider_error",
            extra={
                "code": mapped_error.code,
                "detail": mapped_error.detail,
            },
        )
        raise mapped_error from exc

    verdict = state["verdict"]
    return CheckResponse(
        is_suspicious=verdict["is_suspicious"],
        nearest_match=verdict["nearest_match"],
        match_quality=verdict["match_quality"],
        recommended_action=verdict["recommended_action"],
        llm_verdict=verdict["llm_verdict"],
        confidence=verdict["confidence"],
        latency_ms=int((perf_counter() - start) * 1000),
        source=verdict["source"],
        metadata=verdict["metadata"],
    )


def handle_seed_request(
    payload: SeedRequest,
    request: Request,
    *,
    authorizer: InternalRequestAuthorizer,
    logger: logging.Logger,
) -> SeedResponse:
    verified_request = authorizer.authorize_request(
        request,
        required_capability="intelligence.seed",
        require_tenant=False,
    )
    _log_request(
        logger,
        "intelligence_seed_request",
        verified_request,
        {
            "ecosystem": payload.ecosystem,
            "limit": payload.limit,
            "dry_run": payload.dry_run,
        },
    )
    return SeedResponse(
        ecosystem=payload.ecosystem,
        queued=not payload.dry_run,
        processed_count=payload.limit,
        source="stub",
        message=(
            "Seed request accepted in stub mode. Real registry ingestion and "
            "embedding writes will be added next."
        ),
    )


def _log_request(
    logger: logging.Logger,
    event_name: str,
    verified_request: VerifiedInternalRequest,
    payload_fields: dict[str, Any],
) -> None:
    logger.debug(
        "%s %s",
        event_name,
        json.dumps(
            {
                "service": verified_request.service,
                "tenant_id": verified_request.tenant_id,
                "subject": verified_request.subject,
                **payload_fields,
            },
            sort_keys=True,
        ),
    )
