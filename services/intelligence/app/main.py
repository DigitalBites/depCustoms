from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

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
from .core.migrations import run_database_migrations
from .core.readiness import check_database_readiness
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
    "run_database_migrations",
    "settings",
    "check_database_readiness",
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
        app.state.startup_ready = False
        active_runtime = getattr(app.state, "runtime", None)
        if active_runtime is None:
            active_runtime = build_runtime(effective_settings)
            app.state.runtime = active_runtime
        logger.info(
            "startup_config %s",
            json.dumps(effective_settings.to_log(), sort_keys=True),
        )
        if not effective_settings.stub_mode:
            if effective_settings.auto_migrate_on_startup:
                logger.info("startup_phase_migrations_begin")
                run_database_migrations(effective_settings)
                logger.info("startup_phase_migrations_complete")

            logger.info("startup_phase_readiness_begin")
            readiness = check_database_readiness(effective_settings)
            if not readiness.ok:
                raise RuntimeError(
                    "intelligence schema not ready; missing tables: "
                    + ", ".join(readiness.missing_tables)
                )
            logger.info("startup_phase_readiness_complete")
        else:
            logger.info("startup_phase_stub_mode_skip_db")
        logger.info("startup_phase_prewarm_begin")
        prewarm_services(active_runtime.services)
        logger.info("startup_phase_prewarm_complete")
        app.state.startup_ready = True
        logger.info("startup_phase_ready")
        yield
        app.state.startup_ready = False

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
    app.state.startup_ready = False
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
def healthz(request: Request) -> JSONResponse:
    settings = getattr(request.app.state, "settings", None) or get_settings()
    ts = datetime.now(tz=UTC).isoformat()

    if not getattr(request.app.state, "startup_ready", False):
        return JSONResponse(
            status_code=503,
            content={"ok": False, "status": "starting", "ts": ts},
        )

    if settings.stub_mode:
        return JSONResponse(status_code=200, content={"ok": True, "ts": ts})

    try:
        readiness = check_database_readiness(settings)
        if not readiness.ok:
            return JSONResponse(
                status_code=503,
                content={
                    "ok": False,
                    "status": "schema_not_ready",
                    "missing_tables": readiness.missing_tables,
                    "ts": ts,
                },
            )
    except Exception:
        logger.exception("healthz_failed")
        return JSONResponse(
            status_code=503,
            content={"ok": False, "status": "waiting_for_db", "ts": ts},
        )

    return JSONResponse(status_code=200, content={"ok": True, "ts": ts})


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
