from __future__ import annotations

from dataclasses import dataclass

import openai
import pytest

import app.main as main
from app.core.config import Settings
from app.core.errors import IntelligenceServiceError


class DummyRequest:
    class URL:
        path = "/boom"

    url = URL()


@dataclass
class FakeEmbeddings:
    should_fail: Exception | None = None
    calls: int = 0

    def embed_query(self, text: str) -> list[float]:
        del text
        self.calls += 1
        if self.should_fail is not None:
            raise self.should_fail
        return [0.1]


@dataclass
class FakeJudge:
    should_fail: Exception | None = None
    calls: int = 0

    def judge(self, **kwargs):
        del kwargs
        self.calls += 1
        if self.should_fail is not None:
            raise self.should_fail
        return None


def _auth_error() -> openai.AuthenticationError:
    import httpx

    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    response = httpx.Response(
        401,
        request=request,
        json={"error": {"code": "missing_scope", "message": "Forbidden"}},
    )
    return openai.AuthenticationError(
        "Error code: 401",
        response=response,
        body=response.json(),
    )


def test_build_services_returns_stub_graph_services() -> None:
    services = main.build_services(Settings(INTELLIGENCE_STUB_MODE=True))

    assert services.source == "stub"
    assert services.embedding_model is None
    assert services.query_embeddings is None
    assert services.package_embeddings is None


def test_prewarm_services_skips_stub_mode() -> None:
    services = main.build_services(Settings(INTELLIGENCE_STUB_MODE=True))

    main.prewarm_services(services)

    assert services.source == "stub"


def test_prewarm_services_logs_provider_failures(monkeypatch) -> None:
    warning_calls: list[tuple[tuple, dict]] = []
    exception_calls: list[tuple[tuple, dict]] = []
    monkeypatch.setattr(
        main.logger,
        "warning",
        lambda *args, **kwargs: warning_calls.append((args, kwargs)),
    )
    monkeypatch.setattr(
        main.logger,
        "exception",
        lambda *args, **kwargs: exception_calls.append((args, kwargs)),
    )

    services = main.GraphServices(
        embeddings=FakeEmbeddings(should_fail=_auth_error()),
        neighbor_searcher=object(),
        judge=FakeJudge(should_fail=_auth_error()),
        settings=Settings(),
        source="vector_search",
    )

    main.prewarm_services(services)

    assert [call[0][0] for call in warning_calls] == [
        "embedding_prewarm_failed",
        "judge_prewarm_failed",
    ]
    assert exception_calls == []


def test_prewarm_services_logs_unexpected_failures(monkeypatch) -> None:
    warning_calls: list[tuple[tuple, dict]] = []
    exception_calls: list[tuple[tuple, dict]] = []
    monkeypatch.setattr(
        main.logger,
        "warning",
        lambda *args, **kwargs: warning_calls.append((args, kwargs)),
    )
    monkeypatch.setattr(
        main.logger,
        "exception",
        lambda *args, **kwargs: exception_calls.append((args, kwargs)),
    )

    services = main.GraphServices(
        embeddings=FakeEmbeddings(should_fail=RuntimeError("embed boom")),
        neighbor_searcher=object(),
        judge=FakeJudge(should_fail=RuntimeError("judge boom")),
        settings=Settings(),
        source="vector_search",
    )

    main.prewarm_services(services)

    assert warning_calls == []
    assert [call[0][0] for call in exception_calls] == [
        "embedding_prewarm_failed",
        "judge_prewarm_failed",
    ]


@pytest.mark.anyio
async def test_intelligence_service_error_handler_returns_structured_response() -> None:
    response = await main.intelligence_service_error_handler(
        DummyRequest(),
        IntelligenceServiceError(
            status_code=503,
            code="provider_unavailable",
            message="Provider unavailable",
            detail="timeout",
        ),
    )

    assert response.status_code == 503
    assert response.body == (
        b'{"error":{"code":"provider_unavailable","message":"Provider '
        b'unavailable","detail":"timeout"}}'
    )


@pytest.mark.anyio
async def test_unhandled_exception_handler_returns_internal_error(monkeypatch) -> None:
    logged: list[tuple[tuple, dict]] = []
    monkeypatch.setattr(
        main.logger,
        "exception",
        lambda *args, **kwargs: logged.append((args, kwargs)),
    )

    response = await main.unhandled_exception_handler(
        DummyRequest(),
        RuntimeError("boom"),
    )

    assert response.status_code == 500
    assert response.body == (
        b'{"error":{"code":"internal_error","message":"Internal server '
        b'error","detail":null}}'
    )
    assert logged[0][0][0] == "unhandled_exception"
