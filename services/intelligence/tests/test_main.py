from __future__ import annotations

import importlib
import json
import threading
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import httpx
import jwt
import openai
from fastapi.testclient import TestClient

PRIVATE_JWK = {
    "kty": "EC",
    "x": "GwbnH57MUhgL14dJfayyzuI6o2_mB_Pm8xIuauHXtQs",
    "y": "cYqN0VAcv0BC9wrg3vNgHlKhGP8ZEedUC2A8jXpaGwA",
    "crv": "P-256",
    "d": "4STEXq7W4UY0piCGPueMaQqAAZ5jVRjjA_b1Hq7YgmM",
    "kid": "test-internal-service-1",
    "alg": "ES256",
}
PUBLIC_JWK = {
    "kty": "EC",
    "x": "GwbnH57MUhgL14dJfayyzuI6o2_mB_Pm8xIuauHXtQs",
    "y": "cYqN0VAcv0BC9wrg3vNgHlKhGP8ZEedUC2A8jXpaGwA",
    "crv": "P-256",
    "kid": "test-internal-service-1",
    "alg": "ES256",
}


class FailingGraph:
    def __init__(self, exc: Exception) -> None:
        self._exc = exc

    def invoke(self, state: dict[str, object]) -> dict[str, object]:
        del state
        raise self._exc


class SuccessfulGraph:
    def invoke(self, state: dict[str, object]) -> dict[str, object]:
        package = state["package"]
        return {
            "verdict": {
                "is_suspicious": package == "recat",
                "nearest_match": "react",
                "match_quality": "ambiguous",
                "recommended_action": "review",
                "llm_verdict": "Possible typosquat.",
                "confidence": "high",
                "source": "stub",
                "metadata": {
                    "similarity_score": 0.81,
                    "lexical_similarity_score": 0.75,
                    "candidate_source_rank": 1,
                    "candidate_score_final": 123.4,
                    "candidate_trust": "high",
                    "adjacent_name_found_in_corpus": True,
                    "stage_timings_ms": {"judge": 1},
                    "judge_cache_hit": False,
                },
            }
        }


class BlockingGraph:
    def __init__(self) -> None:
        self.started = threading.Event()
        self.release = threading.Event()

    def invoke(self, state: dict[str, object]) -> dict[str, object]:
        del state
        self.started.set()
        self.release.wait(timeout=5)
        return SuccessfulGraph().invoke({"package": "recat"})


def build_authentication_error() -> openai.AuthenticationError:
    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    response = httpx.Response(
        401,
        request=request,
        json={
            "error": {
                "message": (
                    "You have insufficient permissions for this operation. "
                    "Missing scopes: model.request."
                ),
                "type": "invalid_request_error",
                "code": "missing_scope",
            }
        },
    )
    return openai.AuthenticationError(
        "Error code: 401",
        response=response,
        body=response.json(),
    )


def issue_token(
    service: str = "api",
    audience: str = "customs-intelligence-rpc",
    tenant_id: str | None = "tenant-1",
    token_type: str = "api_connector",
    include_expiry_claims: bool = True,
) -> str:
    key = jwt.algorithms.get_default_algorithms()["ES256"].from_jwk(
        json.dumps(PRIVATE_JWK)
    )
    now = datetime.now(tz=UTC)
    payload = {
        "iss": "customs-control-plane",
        "sub": "api:intelligence-connector",
        "aud": audience,
        "service": service,
        "token_type": token_type,
    }
    if include_expiry_claims:
        payload["iat"] = int(now.timestamp())
        payload["exp"] = int((now + timedelta(minutes=5)).timestamp())
        payload["jti"] = "test-jti-1"
    if tenant_id is not None:
        payload["tenant_id"] = tenant_id

    return jwt.encode(
        payload,
        key=key,
        algorithm="ES256",
        headers={"kid": PRIVATE_JWK["kid"]},
    )


def build_jwks_response() -> httpx.Response:
    request = httpx.Request(
        "GET", "http://localhost:3000/.well-known/internal-service-jwks.json"
    )
    return httpx.Response(200, request=request, json={"keys": [PUBLIC_JWK]})


def load_main(monkeypatch, **env_overrides: str):
    monkeypatch.setenv("INTELLIGENCE_STUB_MODE", "true")
    for key, value in env_overrides.items():
        monkeypatch.setenv(key, value)

    import app.core.config as config
    import app.main as main

    config.get_settings.cache_clear()
    return importlib.reload(main)


def override_runtime_graph(main, graph) -> None:
    runtime = main.build_runtime(main.Settings(INTELLIGENCE_STUB_MODE=True))
    main.app.state.runtime = replace(runtime, check_graph=graph)


def test_healthz_is_public(monkeypatch) -> None:
    main = load_main(monkeypatch)
    client = TestClient(main.app, raise_server_exceptions=False)

    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_check_requires_bearer_token(monkeypatch) -> None:
    main = load_main(monkeypatch)
    client = TestClient(main.app, raise_server_exceptions=False)

    response = client.post(
        "/check",
        json={"ecosystem": "npm", "package": "recat", "description": "React UI"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token"


def test_check_rejects_oversized_body_before_auth(monkeypatch) -> None:
    main = load_main(monkeypatch, INTELLIGENCE_REQUEST_BODY_LIMIT_BYTES="64")
    client = TestClient(main.app, raise_server_exceptions=False)

    response = client.post(
        "/check",
        content=json.dumps(
            {
                "ecosystem": "npm",
                "package": "recat",
                "description": "x" * 200,
            }
        ),
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 413
    assert response.json() == {
        "error": {
            "code": "request_too_large",
            "message": "Request body exceeded the configured limit.",
            "detail": None,
        }
    }


def test_check_accepts_valid_internal_token(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda url, timeout: build_jwks_response())
    main = load_main(monkeypatch)
    override_runtime_graph(main, SuccessfulGraph())
    debug_mock = Mock(wraps=main.logger.debug)
    monkeypatch.setattr(main.logger, "debug", debug_mock)
    client = TestClient(main.app, raise_server_exceptions=False)

    response = client.post(
        "/check",
        headers={"Authorization": f"Bearer {issue_token()}"},
        json={"ecosystem": "npm", "package": "recat", "description": "React UI"},
    )

    assert response.status_code == 200
    assert response.json()["recommended_action"] == "review"
    assert response.json()["nearest_match"] == "react"
    assert any(
        call.args
        and call.args[0] == "%s %s"
        and call.args[1] == "intelligence_check_request"
        and '"tenant_id": "tenant-1"' in call.args[2]
        for call in debug_mock.call_args_list
    )


def test_check_rejects_wrong_service_token(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda url, timeout: build_jwks_response())
    main = load_main(monkeypatch)
    client = TestClient(main.app, raise_server_exceptions=False)

    response = client.post(
        "/check",
        headers={"Authorization": f"Bearer {issue_token(service='proxy')}"},
        json={"ecosystem": "npm", "package": "recat", "description": "React UI"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Token service is not permitted"


def test_check_rejects_missing_tenant_context(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda url, timeout: build_jwks_response())
    main = load_main(monkeypatch)
    client = TestClient(main.app, raise_server_exceptions=False)

    response = client.post(
        "/check",
        headers={"Authorization": f"Bearer {issue_token(tenant_id=None)}"},
        json={"ecosystem": "npm", "package": "recat", "description": "React UI"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Tenant context is required"


def test_seed_rejects_check_only_token(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda url, timeout: build_jwks_response())
    main = load_main(monkeypatch)
    client = TestClient(main.app, raise_server_exceptions=False)

    response = client.post(
        "/seed",
        headers={"Authorization": f"Bearer {issue_token(token_type='api_connector')}"},
        json={"ecosystem": "npm", "limit": 10, "dry_run": True},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Token capability is not permitted"


def test_check_rejects_token_missing_expiry_claims(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda url, timeout: build_jwks_response())
    main = load_main(monkeypatch)
    client = TestClient(main.app, raise_server_exceptions=False)

    response = client.post(
        "/check",
        headers={
            "Authorization": (
                f"Bearer {issue_token(include_expiry_claims=False)}"
            )
        },
        json={"ecosystem": "npm", "package": "recat", "description": "React UI"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid bearer token"


def test_check_rejects_oversized_package_name(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda url, timeout: build_jwks_response())
    main = load_main(monkeypatch)
    client = TestClient(main.app, raise_server_exceptions=False)

    response = client.post(
        "/check",
        headers={"Authorization": f"Bearer {issue_token()}"},
        json={
            "ecosystem": "npm",
            "package": "a" * 257,
            "description": "React UI",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "string_too_long"
    assert response.json()["detail"][0]["loc"] == ["body", "package"]


def test_check_rejects_oversized_description(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda url, timeout: build_jwks_response())
    main = load_main(monkeypatch)
    client = TestClient(main.app, raise_server_exceptions=False)

    response = client.post(
        "/check",
        headers={"Authorization": f"Bearer {issue_token()}"},
        json={
            "ecosystem": "npm",
            "package": "recat",
            "description": "x" * 4097,
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "string_too_long"
    assert response.json()["detail"][0]["loc"] == ["body", "description"]


def test_check_rate_limit_returns_429(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda url, timeout: build_jwks_response())
    main = load_main(monkeypatch, INTELLIGENCE_CHECKS_PER_MINUTE="1")
    override_runtime_graph(main, SuccessfulGraph())
    client = TestClient(main.app, raise_server_exceptions=False)
    headers = {"Authorization": f"Bearer {issue_token()}"}
    payload = {"ecosystem": "npm", "package": "recat", "description": "React UI"}

    first = client.post("/check", headers=headers, json=payload)
    second = client.post("/check", headers=headers, json=payload)

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json() == {
        "error": {
            "code": "rate_limited",
            "message": "Intelligence check rate limit exceeded.",
            "detail": None,
        }
    }


def test_check_concurrency_limit_returns_503(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda url, timeout: build_jwks_response())
    main = load_main(monkeypatch, INTELLIGENCE_CHECK_CONCURRENCY="1")
    graph = BlockingGraph()
    override_runtime_graph(main, graph)
    client = TestClient(main.app, raise_server_exceptions=False)
    headers = {"Authorization": f"Bearer {issue_token()}"}
    payload = {"ecosystem": "npm", "package": "recat", "description": "React UI"}
    responses: dict[str, object] = {}

    def run_first() -> None:
        responses["first"] = client.post("/check", headers=headers, json=payload)

    thread = threading.Thread(target=run_first)
    thread.start()
    assert graph.started.wait(timeout=2)

    second = client.post("/check", headers=headers, json=payload)
    graph.release.set()
    thread.join(timeout=2)
    first = responses["first"]

    assert isinstance(first, httpx.Response)
    assert first.status_code == 200
    assert second.status_code == 503
    assert second.json() == {
        "error": {
            "code": "service_busy",
            "message": "Intelligence service is temporarily busy.",
            "detail": None,
        }
    }


def test_check_returns_structured_provider_error(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda url, timeout: build_jwks_response())
    main = load_main(monkeypatch)
    override_runtime_graph(main, FailingGraph(build_authentication_error()))
    client = TestClient(main.app, raise_server_exceptions=False)

    response = client.post(
        "/check",
        headers={"Authorization": f"Bearer {issue_token()}"},
        json={
            "ecosystem": "npm",
            "package": "recat",
            "description": "React UI library",
        },
    )

    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "provider_auth_failed",
            "message": (
                "OpenAI authentication or permission failed during intelligence "
                "check."
            ),
            "detail": (
                "missing_scope: You have insufficient permissions for this "
                "operation. Missing scopes: model.request."
            ),
        }
    }


def test_check_returns_structured_internal_error(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda url, timeout: build_jwks_response())
    main = load_main(monkeypatch)
    override_runtime_graph(main, FailingGraph(RuntimeError("boom")))
    client = TestClient(main.app, raise_server_exceptions=False)

    response = client.post(
        "/check",
        headers={"Authorization": f"Bearer {issue_token()}"},
        json={
            "ecosystem": "npm",
            "package": "recat",
            "description": "React UI library",
        },
    )

    assert response.status_code == 500
    assert response.json() == {
        "error": {
            "code": "internal_error",
            "message": "Internal server error",
            "detail": None,
        }
    }
