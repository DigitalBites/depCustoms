from __future__ import annotations

import json
from dataclasses import dataclass
from time import monotonic
from typing import Any

import httpx
import jwt
from fastapi import HTTPException, Request, status

from .capabilities import (
    IntelligenceCapability,
    InternalTokenType,
    get_token_type_metadata,
    is_internal_token_type,
)
from .config import Settings

INTERNAL_TOKEN_ISSUER = "customs-control-plane"
JWKS_CACHE_TTL_SECONDS = 300


@dataclass(frozen=True)
class VerifiedInternalRequest:
    subject: str
    service: str
    token_type: InternalTokenType
    tenant_id: str | None
    claims: dict[str, Any]


class InternalTokenVerifier:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._cached_keys: list[dict[str, Any]] = []
        self._cached_at: float = 0.0

    def verify_request(self, request: Request) -> VerifiedInternalRequest:
        auth_header = request.headers.get("authorization", "")
        scheme, _, token = auth_header.partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing bearer token",
            )

        payload = self.verify_token(token.strip())
        service = payload.get("service")
        if not isinstance(service, str):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token service is missing",
            )

        token_type = payload.get("token_type")
        if not isinstance(token_type, str) or not is_internal_token_type(token_type):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Token type is not permitted",
            )
        token_metadata = get_token_type_metadata(token_type)
        if service != token_metadata.service:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Token service is not permitted",
            )

        subject = payload.get("sub")
        if not isinstance(subject, str) or not subject:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token subject is missing",
            )

        return VerifiedInternalRequest(
            subject=subject,
            service=service,
            token_type=token_type,
            tenant_id=payload.get("tenant_id")
            if isinstance(payload.get("tenant_id"), str)
            else None,
            claims=payload,
        )

    def verify_token(self, token: str) -> dict[str, Any]:
        jwk = self._resolve_jwk(token)
        algorithm = jwk.get("alg", "ES256")
        key = jwt.algorithms.get_default_algorithms()[algorithm].from_jwk(
            json.dumps(jwk)
        )
        try:
            payload = jwt.decode(
                token,
                key=key,
                algorithms=[algorithm],
                issuer=INTERNAL_TOKEN_ISSUER,
                audience=self._settings.internal_jwt_audience,
                options={"require": ["exp", "iat", "jti"]},
            )
        except jwt.PyJWTError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid bearer token",
            ) from exc

        if not isinstance(payload, dict):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid bearer token payload",
            )
        return payload

    def _resolve_jwk(self, token: str) -> dict[str, Any]:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid bearer token header",
            ) from exc

        kid = header.get("kid")
        keys = self._load_jwks()
        if kid:
            for key in keys:
                if key.get("kid") == kid:
                    return key
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="No matching JWKS key found",
            )
        if len(keys) == 1:
            return keys[0]
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token header is missing kid",
        )

    def _load_jwks(self) -> list[dict[str, Any]]:
        now = monotonic()
        if (
            self._cached_keys
            and (now - self._cached_at) < JWKS_CACHE_TTL_SECONDS
        ):
            return self._cached_keys

        try:
            response = httpx.get(self._settings.internal_jwks_url, timeout=2.0)
            response.raise_for_status()
            body = response.json()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Internal JWKS is unavailable",
            ) from exc

        keys = body.get("keys")
        if not isinstance(keys, list) or not keys:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Internal JWKS response is invalid",
            )

        normalized_keys = [key for key in keys if isinstance(key, dict)]
        if not normalized_keys:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Internal JWKS response is invalid",
            )

        self._cached_keys = normalized_keys
        self._cached_at = now
        return normalized_keys


class InternalRequestAuthorizer:
    def __init__(self, verifier: InternalTokenVerifier) -> None:
        self._verifier = verifier

    def authorize_request(
        self,
        request: Request,
        *,
        required_capability: IntelligenceCapability,
        require_tenant: bool,
    ) -> VerifiedInternalRequest:
        verified_request = self._verifier.verify_request(request)
        token_metadata = get_token_type_metadata(verified_request.token_type)
        if required_capability not in token_metadata.capabilities:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Token capability is not permitted",
            )

        if require_tenant and verified_request.tenant_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Tenant context is required",
            )

        return verified_request
