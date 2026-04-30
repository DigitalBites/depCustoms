from __future__ import annotations

from dataclasses import dataclass

from openai import (
    APIConnectionError,
    APIStatusError,
    AuthenticationError,
    BadRequestError,
    PermissionDeniedError,
    RateLimitError,
)


@dataclass
class IntelligenceServiceError(Exception):
    status_code: int
    code: str
    message: str
    detail: str | None = None


def error_payload(
    *,
    code: str,
    message: str,
    detail: str | None = None,
) -> dict[str, dict[str, str | None]]:
    return {
        "error": {
            "code": code,
            "message": message,
            "detail": detail,
        }
    }


def _openai_error_detail(exc: Exception) -> str | None:
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            code = error.get("code")
            if isinstance(message, str) and isinstance(code, str):
                return f"{code}: {message}"
            if isinstance(message, str):
                return message
    message = str(exc)
    return message or None


def map_openai_error(exc: Exception) -> IntelligenceServiceError:
    detail = _openai_error_detail(exc)
    if isinstance(exc, AuthenticationError | PermissionDeniedError):
        return IntelligenceServiceError(
            status_code=503,
            code="provider_auth_failed",
            message=(
                "OpenAI authentication or permission failed during intelligence "
                "check."
            ),
            detail=detail,
        )
    if isinstance(exc, RateLimitError):
        return IntelligenceServiceError(
            status_code=503,
            code="provider_rate_limited",
            message="OpenAI rate limited the intelligence check.",
            detail=detail,
        )
    if isinstance(exc, APIConnectionError):
        return IntelligenceServiceError(
            status_code=503,
            code="provider_unavailable",
            message="OpenAI was unavailable during the intelligence check.",
            detail=detail,
        )
    if isinstance(exc, BadRequestError):
        return IntelligenceServiceError(
            status_code=502,
            code="provider_bad_request",
            message="OpenAI rejected the intelligence request payload.",
            detail=detail,
        )
    if isinstance(exc, APIStatusError):
        return IntelligenceServiceError(
            status_code=502,
            code="provider_error",
            message="OpenAI returned an error during the intelligence check.",
            detail=detail,
        )
    return IntelligenceServiceError(
        status_code=500,
        code="internal_error",
        message="Internal server error",
        detail=detail,
    )


OPENAI_PROVIDER_ERRORS: tuple[type[Exception], ...] = (
    AuthenticationError,
    PermissionDeniedError,
    RateLimitError,
    APIConnectionError,
    BadRequestError,
    APIStatusError,
)
