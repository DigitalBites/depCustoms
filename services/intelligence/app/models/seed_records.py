from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

Ecosystem = Annotated[str, Field(pattern=r"^(npm|pypi)$")]


def utc_now_iso() -> datetime:
    return datetime.now(tz=UTC)


class NormalizedSeedRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    ecosystem: Ecosystem
    package: str
    description: str | None
    version: str | None
    source: str
    source_query: str | None
    source_rank: int | None
    popularity_signal: dict[str, Any] = Field(default_factory=dict)
    collected_at: datetime
    source_record_hash: str

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json")

    @field_validator("package")
    @classmethod
    def validate_package(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized:
            raise ValueError("package must not be empty")
        return normalized

    @field_validator("description", "version", "source_query")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("source")
    @classmethod
    def validate_source(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("source must not be empty")
        return normalized

    @field_validator("source_rank")
    @classmethod
    def validate_source_rank(cls, value: int | None) -> int | None:
        if value is not None and value <= 0:
            raise ValueError("source_rank must be greater than 0")
        return value

    @field_validator("source_record_hash")
    @classmethod
    def validate_source_record_hash(cls, value: str) -> str:
        normalized = value.strip().lower()
        if len(normalized) != 64:
            raise ValueError("source_record_hash must be a 64-character hex digest")
        if any(character not in "0123456789abcdef" for character in normalized):
            raise ValueError("source_record_hash must be a 64-character hex digest")
        return normalized


def hash_seed_record(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def metadata_hash_for_seed_record(
    record: NormalizedSeedRecord,
    *,
    search_eligible: bool,
) -> str:
    payload = {
        "source": record.source,
        "source_query": record.source_query,
        "source_rank": record.source_rank,
        "source_score_final": record.popularity_signal.get("score_final"),
        "search_eligible": search_eligible,
    }
    return hash_seed_record(payload)
