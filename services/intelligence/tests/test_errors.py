from __future__ import annotations

import httpx
import openai

from app.core.errors import (
    IntelligenceServiceError,
    _openai_error_detail,
    error_payload,
    map_openai_error,
)


def _request() -> httpx.Request:
    return httpx.Request("POST", "https://api.openai.com/v1/chat/completions")


def test_error_payload_shapes_response() -> None:
    assert error_payload(
        code="provider_error",
        message="Provider failed.",
        detail="timeout",
    ) == {
        "error": {
            "code": "provider_error",
            "message": "Provider failed.",
            "detail": "timeout",
        }
    }


def test_openai_error_detail_prefers_nested_code_and_message() -> None:
    response = httpx.Response(
        401,
        request=_request(),
        json={"error": {"code": "missing_scope", "message": "Forbidden"}},
    )
    exc = openai.AuthenticationError(
        "Error code: 401",
        response=response,
        body=response.json(),
    )

    assert _openai_error_detail(exc) == "missing_scope: Forbidden"


def test_openai_error_detail_falls_back_to_message_only() -> None:
    response = httpx.Response(
        429,
        request=_request(),
        json={"error": {"message": "Too many requests"}},
    )
    exc = openai.RateLimitError(
        "Error code: 429",
        response=response,
        body=response.json(),
    )

    assert _openai_error_detail(exc) == "Too many requests"


def test_openai_error_detail_falls_back_to_exception_string() -> None:
    assert _openai_error_detail(RuntimeError("boom")) == "boom"


def test_map_openai_error_handles_authentication_error() -> None:
    response = httpx.Response(
        401,
        request=_request(),
        json={"error": {"code": "missing_scope", "message": "Forbidden"}},
    )
    exc = openai.AuthenticationError(
        "Error code: 401",
        response=response,
        body=response.json(),
    )

    mapped = map_openai_error(exc)

    assert mapped == IntelligenceServiceError(
        status_code=503,
        code="provider_auth_failed",
        message="OpenAI authentication or permission failed during intelligence check.",
        detail="missing_scope: Forbidden",
    )


def test_map_openai_error_handles_permission_denied_error() -> None:
    response = httpx.Response(
        403,
        request=_request(),
        json={"error": {"code": "forbidden", "message": "Not allowed"}},
    )
    exc = openai.PermissionDeniedError(
        "Error code: 403",
        response=response,
        body=response.json(),
    )

    mapped = map_openai_error(exc)

    assert mapped.status_code == 503
    assert mapped.code == "provider_auth_failed"
    assert mapped.detail == "forbidden: Not allowed"


def test_map_openai_error_handles_rate_limit_error() -> None:
    response = httpx.Response(
        429,
        request=_request(),
        json={"error": {"message": "Too many requests"}},
    )
    exc = openai.RateLimitError(
        "Error code: 429",
        response=response,
        body=response.json(),
    )

    mapped = map_openai_error(exc)

    assert mapped.status_code == 503
    assert mapped.code == "provider_rate_limited"


def test_map_openai_error_handles_connection_error() -> None:
    exc = openai.APIConnectionError(message="connection failed", request=_request())

    mapped = map_openai_error(exc)

    assert mapped.status_code == 503
    assert mapped.code == "provider_unavailable"
    assert mapped.detail == "connection failed"


def test_map_openai_error_handles_bad_request_error() -> None:
    response = httpx.Response(
        400,
        request=_request(),
        json={"error": {"code": "bad_request", "message": "Bad input"}},
    )
    exc = openai.BadRequestError(
        "Error code: 400",
        response=response,
        body=response.json(),
    )

    mapped = map_openai_error(exc)

    assert mapped.status_code == 502
    assert mapped.code == "provider_bad_request"


def test_map_openai_error_handles_status_error() -> None:
    response = httpx.Response(
        500,
        request=_request(),
        json={"error": {"code": "server_error", "message": "Internal failure"}},
    )
    exc = openai.InternalServerError(
        "Error code: 500",
        response=response,
        body=response.json(),
    )

    mapped = map_openai_error(exc)

    assert mapped.status_code == 502
    assert mapped.code == "provider_error"


def test_map_openai_error_handles_unknown_exception() -> None:
    mapped = map_openai_error(RuntimeError("boom"))

    assert mapped == IntelligenceServiceError(
        status_code=500,
        code="internal_error",
        message="Internal server error",
        detail="boom",
    )
