from __future__ import annotations

import hashlib
import re
from functools import lru_cache
from typing import Any, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: str = Field(default="development", alias="ENVIRONMENT")
    database_url: str = Field(default="", alias="DATABASE_URL")
    database_schema: str = Field(default="intel", alias="INTELLIGENCE_DB_SCHEMA")
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    embedding_model: str = Field(
        default="openai/text-embedding-3-small", alias="EMBEDDING_MODEL"
    )
    judge_model: str = Field(default="openai/gpt-4o-mini", alias="JUDGE_MODEL")
    port: int = Field(default=8001, alias="INTELLIGENCE_PORT")
    log_level: str = Field(default="info", alias="LOG_LEVEL")
    request_body_limit_bytes: int = Field(
        default=16_384, alias="INTELLIGENCE_REQUEST_BODY_LIMIT_BYTES"
    )
    check_requests_per_minute: int = Field(
        default=120, alias="INTELLIGENCE_CHECKS_PER_MINUTE"
    )
    check_concurrency_limit: int = Field(
        default=8, alias="INTELLIGENCE_CHECK_CONCURRENCY"
    )
    similarity_low_threshold: float = Field(
        default=0.85, alias="SIMILARITY_LOW_THRESHOLD"
    )
    similarity_high_threshold: float = Field(
        default=0.97, alias="SIMILARITY_HIGH_THRESHOLD"
    )
    search_top_k: int = Field(default=5, alias="SEARCH_TOP_K")
    stub_mode: bool = Field(default=False, alias="INTELLIGENCE_STUB_MODE")
    internal_jwks_url: str = Field(
        default="http://localhost:3000/.well-known/internal-service-jwks.json",
        alias="INTELLIGENCE_INTERNAL_JWKS_URL",
    )
    internal_jwt_audience: str = Field(
        default="customs-intelligence-rpc",
        alias="INTELLIGENCE_INTERNAL_JWT_AUDIENCE",
    )

    @field_validator("database_schema")
    @classmethod
    def validate_database_schema(cls, value: str) -> str:
        normalized: str = value.strip()
        if not normalized:
            raise ValueError("INTELLIGENCE_DB_SCHEMA must not be empty")
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", normalized) is None:
            raise ValueError(
                "INTELLIGENCE_DB_SCHEMA must be a valid PostgreSQL schema identifier"
            )
        return normalized

    @field_validator("port")
    @classmethod
    def validate_port(cls, value: int) -> int:
        if value < 1 or value > 65535:
            raise ValueError("INTELLIGENCE_PORT must be between 1 and 65535")
        return value

    @field_validator("search_top_k")
    @classmethod
    def validate_search_top_k(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("SEARCH_TOP_K must be greater than 0")
        return value

    @field_validator(
        "request_body_limit_bytes",
        "check_requests_per_minute",
        "check_concurrency_limit",
    )
    @classmethod
    def validate_positive_int(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("security limit settings must be greater than 0")
        return value

    @field_validator("similarity_low_threshold", "similarity_high_threshold")
    @classmethod
    def validate_threshold(cls, value: float) -> float:
        if value < 0.0 or value > 1.0:
            raise ValueError("similarity thresholds must be between 0.0 and 1.0")
        return value

    @field_validator("embedding_model", "judge_model")
    @classmethod
    def validate_provider_qualified_model(cls, value: str) -> str:
        provider, _, model_name = value.partition("/")
        if not provider or not model_name:
            raise ValueError(
                "model ids must be provider-qualified, for example "
                "'openai/text-embedding-3-small'"
            )
        if provider != "openai":
            raise ValueError(
                "unsupported model provider; v1 currently supports only 'openai/...'"
            )
        return value

    @property
    def embedding_provider(self) -> Literal["openai"]:
        return "openai"

    @property
    def embedding_model_name(self) -> str:
        _, _, model_name = self.embedding_model.partition("/")
        return model_name

    @property
    def judge_provider(self) -> Literal["openai"]:
        return "openai"

    @property
    def judge_model_name(self) -> str:
        _, _, model_name = self.judge_model.partition("/")
        return model_name

    @property
    def openai_api_key_fingerprint(self) -> str | None:
        if not self.openai_api_key:
            return None
        digest = hashlib.sha256(self.openai_api_key.encode("utf-8")).hexdigest()
        return digest[:12]

    def to_log(self) -> dict[str, Any]:
        return {
            "database": {
                "configured": self.database_url != "",
                "schema": self.database_schema,
            },
            "embeddings": {
                "openai_api_key_configured": self.openai_api_key != "",
                "openai_api_key_fingerprint": self.openai_api_key_fingerprint,
                "embedding_model": self.embedding_model,
                "embedding_provider": self.embedding_provider,
            },
            "judge": {
                "openai_api_key_configured": self.openai_api_key != "",
                "openai_api_key_fingerprint": self.openai_api_key_fingerprint,
                "judge_model": self.judge_model,
                "judge_provider": self.judge_provider,
            },
            "service": {
                "environment": self.environment,
                "port": self.port,
                "log_level": self.log_level,
                "stub_mode": self.stub_mode,
                "request_body_limit_bytes": self.request_body_limit_bytes,
            },
            "auth": {
                "internal_jwks_url": self.internal_jwks_url,
                "internal_jwt_audience": self.internal_jwt_audience,
            },
            "limits": {
                "check_requests_per_minute": self.check_requests_per_minute,
                "check_concurrency_limit": self.check_concurrency_limit,
            },
            "search": {
                "similarity_low_threshold": self.similarity_low_threshold,
                "similarity_high_threshold": self.similarity_high_threshold,
                "search_top_k": self.search_top_k,
            },
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
