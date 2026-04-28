from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .bootstrap import (
    AppRuntime,
    build_runtime,
    build_services,
    configure_logging,
    logger,
    prewarm_services,
)
from .checks.graph import GraphServices
from .core.body_limit import BodyLimitMiddleware
from .core.config import Settings, get_settings
from .core.errors import (
    IntelligenceServiceError,
    error_payload,
)
from .schemas import CheckRequest, CheckResponse, SeedRequest, SeedResponse
from .services.request_flow import handle_check_request, handle_seed_request

__all__ = [
    "AppRuntime",
    "GraphServices",
    "app",
    "build_runtime",
    "build_services",
    "configure_logging",
    "create_app",
    "intelligence_service_error_handler",
    "logger",
    "prewarm_services",
    "settings",
    "unhandled_exception_handler",
]


def _get_runtime(app: FastAPI) -> AppRuntime:
    runtime = getattr(app.state, "runtime", None)
    if runtime is None:
        settings = getattr(app.state, "settings", None)
        if settings is None:
            raise RuntimeError("application settings are not initialized")
        runtime = build_runtime(settings)
        app.state.runtime = runtime
    return runtime


def create_app(
    *,
    settings: Settings | None = None,
    runtime: AppRuntime | None = None,
) -> FastAPI:
    effective_settings = settings or get_settings()
    configure_logging(effective_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        active_runtime = getattr(app.state, "runtime", None)
        if active_runtime is None:
            active_runtime = build_runtime(effective_settings)
            app.state.runtime = active_runtime
        logger.info(
            "startup_config %s",
            json.dumps(effective_settings.to_log(), sort_keys=True),
        )
        prewarm_services(active_runtime.services)
        yield

    app = FastAPI(
        title="Customs Intelligence Service",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.add_middleware(
        BodyLimitMiddleware,
        limit_bytes=effective_settings.request_body_limit_bytes,
    )
    app.state.settings = effective_settings
    app.state.runtime = runtime
    return app


settings = get_settings()
app = create_app(settings=settings)


@app.exception_handler(IntelligenceServiceError)
async def intelligence_service_error_handler(
    request: Request,
    exc: IntelligenceServiceError,
) -> JSONResponse:
    del request
    return JSONResponse(
        status_code=exc.status_code,
        content=error_payload(
            code=exc.code,
            message=exc.message,
            detail=exc.detail,
        ),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(
    request: Request,
    exc: Exception,
) -> JSONResponse:
    logger.exception(
        "unhandled_exception",
        extra={
            "path": request.url.path,
        },
    )
    return JSONResponse(
        status_code=500,
        content=error_payload(
            code="internal_error",
            message="Internal server error",
            detail=None,
        ),
    )


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/check", response_model=CheckResponse)
def check_package(payload: CheckRequest, request: Request) -> CheckResponse:
    runtime = _get_runtime(request.app)
    return handle_check_request(
        payload,
        request,
        authorizer=runtime.request_authorizer,
        check_graph=runtime.check_graph,
        check_limiter=runtime.check_limiter,
        logger=logger,
    )


@app.post("/seed", response_model=SeedResponse)
def seed(payload: SeedRequest, request: Request) -> SeedResponse:
    runtime = _get_runtime(request.app)
    return handle_seed_request(
        payload,
        request,
        authorizer=runtime.request_authorizer,
        logger=logger,
    )
