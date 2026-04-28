from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.models.artifacts import ArtifactManifest
from app.models.seed_records import NormalizedSeedRecord


def test_normalized_seed_record_normalizes_package_name() -> None:
    record = NormalizedSeedRecord(
        ecosystem="npm",
        package=" React ",
        description=" UI library ",
        version=" 19.0.0 ",
        source=" seed_npm ",
        source_query=" react ",
        source_rank=1,
        popularity_signal={"score_final": 0.99},
        collected_at=datetime(2026, 4, 21, tzinfo=UTC),
        source_record_hash="a" * 64,
    )

    assert record.package == "react"
    assert record.description == "UI library"
    assert record.version == "19.0.0"
    assert record.source == "seed_npm"
    assert record.source_query == "react"


def test_normalized_seed_record_rejects_invalid_hash() -> None:
    with pytest.raises(ValidationError):
        NormalizedSeedRecord(
            ecosystem="npm",
            package="react",
            description="UI library",
            version="19.0.0",
            source="seed_npm",
            source_query="react",
            source_rank=1,
            popularity_signal={"score_final": 0.99},
            collected_at=datetime(2026, 4, 21, tzinfo=UTC),
            source_record_hash="abc123",
        )


def test_artifact_manifest_rejects_invalid_kind() -> None:
    with pytest.raises(ValidationError):
        ArtifactManifest(
            ecosystem="npm",
            artifact_kind="bad",
            collected_at=datetime(2026, 4, 21, tzinfo=UTC),
            collector_version="test-v1",
            source="unit-test",
            artifact_path="data/npm/raw/test.ndjson.gz",
            record_count=3,
            compressed_bytes=10,
            uncompressed_bytes=20,
            metadata={},
        )
