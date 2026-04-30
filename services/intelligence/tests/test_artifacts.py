from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from app.models.artifacts import ArtifactManifest
from app.services.artifact_store import ArtifactStore


def test_write_and_read_ndjson_gz_roundtrip(tmp_path: Path) -> None:
    artifact_path = tmp_path / "records.ndjson.gz"
    store = ArtifactStore()
    records = [
        {"ecosystem": "npm", "package": "lodash"},
        {"ecosystem": "npm", "package": "react"},
    ]

    stats = store.write_records(artifact_path, records)

    assert stats.compressed_bytes > 0
    assert stats.uncompressed_bytes > 0
    assert store.read_records(artifact_path) == records


def test_write_manifest_persists_json(tmp_path: Path) -> None:
    manifest_path = tmp_path / "artifact.manifest.json"
    store = ArtifactStore()
    manifest = ArtifactManifest(
        ecosystem="npm",
        artifact_kind="raw",
        collected_at="2026-04-21T00:00:00+00:00",
        collector_version="test-v1",
        source="unit-test",
        artifact_path="data/npm/raw/test.ndjson.gz",
        record_count=3,
        compressed_bytes=10,
        uncompressed_bytes=20,
        metadata={"queries": ["react"]},
    )

    store.write_manifest(manifest_path, manifest)

    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert payload["ecosystem"] == "npm"
    assert payload["record_count"] == 3


def test_write_ndjson_gz_serializes_datetime_values(tmp_path: Path) -> None:
    artifact_path = tmp_path / "records.ndjson.gz"
    store = ArtifactStore()
    records = [
        {
            "ecosystem": "npm",
            "package": "react",
            "collected_at": datetime(2026, 4, 22, tzinfo=UTC),
        }
    ]

    store.write_records(artifact_path, records)

    payload = store.read_records(artifact_path)
    assert payload[0]["collected_at"] == "2026-04-22 00:00:00+00:00"
