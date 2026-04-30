from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.checks.embeddings import EmbeddingClient
from app.core.config import Settings
from app.domain.corpus_policy import is_search_eligible
from app.models.seed_records import (
    NormalizedSeedRecord,
    metadata_hash_for_seed_record,
)
from app.repositories.package_embeddings import ExistingSeedRecordState
from app.services.artifact_store import ArtifactStore
from app.services.npm_seed_pipeline import NpmSeedPipelineService
from app.services.seed_loader import SeedLoaderService


@dataclass
class FakePackageEmbeddingRepository:
    inserted_records: list[NormalizedSeedRecord] | None = None
    embedding_model: str | None = None
    existing_by_key: dict[tuple[str, str], ExistingSeedRecordState] = field(
        default_factory=dict
    )
    touched_keys: list[tuple[str, str]] = field(default_factory=list)

    def fetch_existing_seed_records(
        self,
        records: list[NormalizedSeedRecord],
    ) -> dict[tuple[str, str], ExistingSeedRecordState]:
        del records
        return self.existing_by_key

    def upsert_seed_records(
        self,
        records: list[NormalizedSeedRecord],
        embeddings_by_package: dict[tuple[str, str], list[float]],
        embedding_model: str,
        run_id: str,
    ) -> tuple[int, int, int]:
        self.inserted_records = records
        self.embedding_model = embedding_model
        self.touched_keys = [(record.ecosystem, record.package) for record in records]
        assert run_id == "run-123"
        if ("npm", "react") in embeddings_by_package:
            assert embeddings_by_package[("npm", "react")] == [0.1, 0.2]

        inserted = 0
        updated = 0
        skipped = 0
        for record in records:
            existing_state = self.existing_by_key.get(
                (record.ecosystem, record.package)
            )
            metadata_hash = metadata_hash_for_seed_record(
                record,
                search_eligible=is_search_eligible(record),
            )
            if (
                existing_state is not None
                and existing_state.source_record_hash == record.source_record_hash
                and existing_state.metadata_hash == metadata_hash
            ):
                skipped += 1
            elif existing_state is None:
                inserted += 1
            else:
                updated += 1
        return (inserted, updated, skipped)


@dataclass
class FakeSeedRunRepository:
    created_run_id: str = "run-123"
    completed_status: str | None = None
    expected_records_inserted: int = 1
    expected_records_updated: int = 0
    expected_records_skipped: int = 0
    expected_status: str = "succeeded"
    expected_error_summary: str | None = None

    def create(
        self,
        ecosystem: str,
        operation: str,
        source: str,
        artifact_path: str | None,
    ) -> str:
        assert ecosystem == "npm"
        assert operation == "load"
        assert source == "normalized_artifact"
        assert artifact_path == "data/npm/normalized/npm-seed-records.ndjson.gz"
        return self.created_run_id

    def complete(
        self,
        run_id: str,
        status: str,
        records_seen: int,
        records_inserted: int,
        records_updated: int,
        records_skipped: int,
        error_summary: str | None = None,
    ) -> None:
        assert run_id == self.created_run_id
        assert records_seen == 1
        assert status == self.expected_status
        assert records_inserted == self.expected_records_inserted
        assert records_updated == self.expected_records_updated
        assert records_skipped == self.expected_records_skipped
        assert error_summary == self.expected_error_summary
        self.completed_status = status


def test_seed_loader_service_loads_records() -> None:
    package_embeddings = FakePackageEmbeddingRepository()
    seed_runs = FakeSeedRunRepository()
    service = SeedLoaderService(
        package_embeddings=package_embeddings,
        seed_runs=seed_runs,
    )
    records = [
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
            source_record_hash="a" * 64,
        )
    ]
    embedding_client = FakeEmbeddingClient()

    result = service.load_records(
        ecosystem="npm",
        operation="load",
        source="normalized_artifact",
        artifact_path="data/npm/normalized/npm-seed-records.ndjson.gz",
        records=records,
        embedding_model="openai/text-embedding-3-small",
        embedding_client=embedding_client,
    )

    assert result.run_id == "run-123"
    assert result.records_seen == 1
    assert result.records_inserted == 1
    assert result.records_updated == 0
    assert result.records_skipped == 0
    assert package_embeddings.inserted_records == records
    assert package_embeddings.embedding_model == "openai/text-embedding-3-small"
    assert seed_runs.completed_status == "succeeded"
    assert embedding_client.calls == [["npm: react - UI library"]]


def test_npm_seed_pipeline_load_rejects_stub_mode(tmp_path: Path) -> None:
    record = NormalizedSeedRecord(
        ecosystem="npm",
        package="react",
        description="UI library",
        version="19.0.0",
        source="seed_npm",
        source_query="react",
        source_rank=1,
        popularity_signal={"score_final": 0.99},
        collected_at=datetime(2026, 4, 22, tzinfo=UTC),
        source_record_hash="a" * 64,
    )
    artifact_path = tmp_path / "npm-seed-records.ndjson.gz"
    ArtifactStore().write_records(artifact_path, [record.to_dict()])
    service = NpmSeedPipelineService(
        settings=Settings(INTELLIGENCE_STUB_MODE=True),
        artifact_store=ArtifactStore(),
    )

    with pytest.raises(ValueError, match="INTELLIGENCE_STUB_MODE=false"):
        service.load(input_path=artifact_path)


@dataclass
class FakeEmbeddingClient(EmbeddingClient):
    calls: list[list[str]] = field(default_factory=list)

    def embed_query(self, text: str) -> list[float]:
        return [0.1, 0.2] if "react" in text else [0.0, 0.0]

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        self.calls.append(texts)
        return [self.embed_query(text) for text in texts]


def test_seed_loader_service_skips_unchanged_records_before_embedding() -> None:
    existing_record = NormalizedSeedRecord(
        ecosystem="npm",
        package="react",
        description="UI library",
        version="19.0.0",
        source="seed_npm",
        source_query="react",
        source_rank=1,
        popularity_signal={"score_final": 0.99},
        collected_at=datetime(2026, 4, 21, tzinfo=UTC),
        source_record_hash="a" * 64,
    )
    package_embeddings = FakePackageEmbeddingRepository(
        existing_by_key={
            ("npm", "react"): ExistingSeedRecordState(
                source_record_hash="a" * 64,
                metadata_hash=metadata_hash_for_seed_record(
                    existing_record,
                    search_eligible=is_search_eligible(existing_record),
                ),
            )
        }
    )
    seed_runs = FakeSeedRunRepository(
        expected_records_inserted=0,
        expected_records_updated=0,
        expected_records_skipped=1,
    )
    embedding_client = FakeEmbeddingClient()
    service = SeedLoaderService(
        package_embeddings=package_embeddings,
        seed_runs=seed_runs,
    )
    records = [existing_record]

    result = service.load_records(
        ecosystem="npm",
        operation="load",
        source="normalized_artifact",
        artifact_path="data/npm/normalized/npm-seed-records.ndjson.gz",
        records=records,
        embedding_model="openai/text-embedding-3-small",
        embedding_client=embedding_client,
    )

    assert result.records_seen == 1
    assert result.records_inserted == 0
    assert result.records_updated == 0
    assert result.records_skipped == 1
    assert embedding_client.calls == []


def test_seed_loader_service_does_not_prune_absent_corpus_rows() -> None:
    existing_record = NormalizedSeedRecord(
        ecosystem="npm",
        package="react",
        description="UI library",
        version="19.0.0",
        source="seed_npm",
        source_query="react",
        source_rank=1,
        popularity_signal={"score_final": 0.99},
        collected_at=datetime(2026, 4, 21, tzinfo=UTC),
        source_record_hash="a" * 64,
    )
    package_embeddings = FakePackageEmbeddingRepository(
        existing_by_key={
            ("npm", "react"): ExistingSeedRecordState(
                source_record_hash="a" * 64,
                metadata_hash=metadata_hash_for_seed_record(
                    existing_record,
                    search_eligible=is_search_eligible(existing_record),
                ),
            ),
            ("npm", "commander"): ExistingSeedRecordState(
                source_record_hash="b" * 64,
                metadata_hash="n" * 64,
            ),
        }
    )
    seed_runs = FakeSeedRunRepository(
        expected_records_inserted=0,
        expected_records_updated=0,
        expected_records_skipped=1,
    )
    embedding_client = FakeEmbeddingClient()
    service = SeedLoaderService(
        package_embeddings=package_embeddings,
        seed_runs=seed_runs,
    )
    records = [existing_record]

    result = service.load_records(
        ecosystem="npm",
        operation="load",
        source="normalized_artifact",
        artifact_path="data/npm/normalized/npm-seed-records.ndjson.gz",
        records=records,
        embedding_model="openai/text-embedding-3-small",
        embedding_client=embedding_client,
    )

    assert result.records_seen == 1
    assert result.records_inserted == 0
    assert result.records_updated == 0
    assert result.records_skipped == 1
    assert package_embeddings.touched_keys == [("npm", "react")]
    assert ("npm", "commander") in package_embeddings.existing_by_key


def test_seed_loader_service_skips_embedding_for_metadata_only_updates() -> None:
    package_embeddings = FakePackageEmbeddingRepository(
        existing_by_key={
            ("npm", "react"): ExistingSeedRecordState(
                source_record_hash="a" * 64,
                metadata_hash="old" * 16,
            )
        }
    )
    seed_runs = FakeSeedRunRepository(
        expected_records_inserted=0,
        expected_records_updated=1,
        expected_records_skipped=0,
    )
    embedding_client = FakeEmbeddingClient()
    service = SeedLoaderService(
        package_embeddings=package_embeddings,
        seed_runs=seed_runs,
    )
    records = [
        NormalizedSeedRecord(
            ecosystem="npm",
            package="react",
            description="UI library",
            version="19.0.0",
            source="seed_npm",
            source_query="react",
            source_rank=2,
            popularity_signal={"score_final": 0.50},
            collected_at=datetime(2026, 4, 21, tzinfo=UTC),
            source_record_hash="a" * 64,
        )
    ]

    result = service.load_records(
        ecosystem="npm",
        operation="load",
        source="normalized_artifact",
        artifact_path="data/npm/normalized/npm-seed-records.ndjson.gz",
        records=records,
        embedding_model="openai/text-embedding-3-small",
        embedding_client=embedding_client,
    )

    assert result.records_seen == 1
    assert result.records_inserted == 0
    assert result.records_updated == 1
    assert result.records_skipped == 0
    assert embedding_client.calls == []
