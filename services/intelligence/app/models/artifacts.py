from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ArtifactManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    ecosystem: str
    artifact_kind: str
    collected_at: datetime
    collector_version: str
    source: str
    artifact_path: str
    record_count: int = Field(ge=0)
    compressed_bytes: int = Field(ge=0)
    uncompressed_bytes: int = Field(ge=0)
    metadata: dict[str, Any] = Field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json")

    @field_validator("ecosystem")
    @classmethod
    def validate_ecosystem(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"npm", "pypi"}:
            raise ValueError("ecosystem must be one of: npm, pypi")
        return normalized

    @field_validator("artifact_kind")
    @classmethod
    def validate_artifact_kind(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"raw", "normalized"}:
            raise ValueError("artifact_kind must be one of: raw, normalized")
        return normalized
