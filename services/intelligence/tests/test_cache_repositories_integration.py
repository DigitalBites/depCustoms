from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import select, text

from app.core.database_schema import build_intelligence_tables
from app.repositories.base import RepositoryContext
from app.repositories.check_judge_results import CheckJudgeResultRepository
from app.repositories.check_query_embeddings import CheckQueryEmbeddingRepository
from app.repositories.seed_runs import SeedRunRepository


def _vector(value: float) -> list[float]:
    return [value] * 1536


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL is required for repository integration tests",
)
def test_check_query_embedding_repository_round_trips_and_updates() -> None:
    schema = f"intel_test_{uuid.uuid4().hex[:12]}"
    context = RepositoryContext(
        database_url=os.environ["DATABASE_URL"],
        database_schema=schema,
    )
    repository = CheckQueryEmbeddingRepository(context)
    tables = build_intelligence_tables(schema)

    with context.engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        tables.metadata.create_all(connection)

    try:
        assert (
            repository.fetch_embedding(
                embedding_model="openai/text-embedding-3-small",
                request_hash="req-1",
            )
            is None
        )

        repository.record_embedding(
            embedding_model="openai/text-embedding-3-small",
            request_hash="req-1",
            ecosystem="npm",
            package="recat",
            description="React UI library",
            request_text="npm: recat - React UI library",
            embedding=_vector(0.1),
        )
        repository.record_embedding(
            embedding_model="openai/text-embedding-3-small",
            request_hash="req-1",
            ecosystem="npm",
            package="recat",
            description="Updated description",
            request_text="npm: recat - Updated description",
            embedding=_vector(0.2),
        )

        embedding = repository.fetch_embedding(
            embedding_model="openai/text-embedding-3-small",
            request_hash="req-1",
        )

        assert embedding is not None
        assert embedding == pytest.approx(_vector(0.2))

        with context.engine.connect() as connection:
            row = connection.execute(
                select(
                    tables.check_query_embeddings.c.description,
                    tables.check_query_embeddings.c.request_text,
                    tables.check_query_embeddings.c.hit_count,
                )
            ).one()

        assert row.description == "Updated description"
        assert row.request_text == "npm: recat - Updated description"
        assert row.hit_count == 2
    finally:
        with context.engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL is required for repository integration tests",
)
def test_check_query_embedding_repository_bumps_hit_count_without_rewriting() -> None:
    schema = f"intel_test_{uuid.uuid4().hex[:12]}"
    context = RepositoryContext(
        database_url=os.environ["DATABASE_URL"],
        database_schema=schema,
    )
    repository = CheckQueryEmbeddingRepository(context)
    tables = build_intelligence_tables(schema)

    with context.engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        tables.metadata.create_all(connection)

    try:
        repository.record_embedding(
            embedding_model="openai/text-embedding-3-small",
            request_hash="req-1",
            ecosystem="npm",
            package="recat",
            description="React UI library",
            request_text="npm: recat - React UI library",
            embedding=_vector(0.1),
        )
        repository.bump_hit_count(
            embedding_model="openai/text-embedding-3-small",
            request_hash="req-1",
        )

        with context.engine.connect() as connection:
            row = connection.execute(
                select(
                    tables.check_query_embeddings.c.description,
                    tables.check_query_embeddings.c.request_text,
                    tables.check_query_embeddings.c.embedding,
                    tables.check_query_embeddings.c.hit_count,
                )
            ).one()

        assert row.description == "React UI library"
        assert row.request_text == "npm: recat - React UI library"
        assert list(row.embedding) == pytest.approx(_vector(0.1))
        assert row.hit_count == 2
    finally:
        with context.engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL is required for repository integration tests",
)
def test_check_judge_result_repository_round_trips_and_updates() -> None:
    schema = f"intel_test_{uuid.uuid4().hex[:12]}"
    context = RepositoryContext(
        database_url=os.environ["DATABASE_URL"],
        database_schema=schema,
    )
    repository = CheckJudgeResultRepository(context)
    tables = build_intelligence_tables(schema)

    with context.engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        tables.metadata.create_all(connection)

    try:
        assert (
            repository.fetch_decision(
                judge_model="openai/gpt-4o-mini",
                request_hash="req-1",
                candidate_hash="cand-1",
            )
            is None
        )

        repository.record_decision(
            judge_model="openai/gpt-4o-mini",
            request_hash="req-1",
            candidate_hash="cand-1",
            ecosystem="npm",
            package="recat",
            description="React UI library",
            suspicious=True,
            selected_match="react",
            rationale="Likely typo.",
            confidence="high",
        )
        repository.record_decision(
            judge_model="openai/gpt-4o-mini",
            request_hash="req-1",
            candidate_hash="cand-1",
            ecosystem="npm",
            package="recat",
            description="Updated description",
            suspicious=False,
            selected_match=None,
            rationale="Not suspicious after review.",
            confidence="low",
        )

        decision = repository.fetch_decision(
            judge_model="openai/gpt-4o-mini",
            request_hash="req-1",
            candidate_hash="cand-1",
        )

        assert decision == {
            "suspicious": False,
            "selected_match": None,
            "rationale": "Not suspicious after review.",
            "confidence": "low",
        }

        with context.engine.connect() as connection:
            row = connection.execute(
                select(
                    tables.check_judge_results.c.description,
                    tables.check_judge_results.c.hit_count,
                )
            ).one()

        assert row.description == "Updated description"
        assert row.hit_count == 2
    finally:
        with context.engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL is required for repository integration tests",
)
def test_check_judge_result_repository_bumps_hit_count_without_rewriting() -> None:
    schema = f"intel_test_{uuid.uuid4().hex[:12]}"
    context = RepositoryContext(
        database_url=os.environ["DATABASE_URL"],
        database_schema=schema,
    )
    repository = CheckJudgeResultRepository(context)
    tables = build_intelligence_tables(schema)

    with context.engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        tables.metadata.create_all(connection)

    try:
        repository.record_decision(
            judge_model="openai/gpt-4o-mini",
            request_hash="req-1",
            candidate_hash="cand-1",
            ecosystem="npm",
            package="recat",
            description="React UI library",
            suspicious=True,
            selected_match="react",
            rationale="Likely typo.",
            confidence="high",
        )
        repository.bump_hit_count(
            judge_model="openai/gpt-4o-mini",
            request_hash="req-1",
            candidate_hash="cand-1",
        )

        with context.engine.connect() as connection:
            row = connection.execute(
                select(
                    tables.check_judge_results.c.description,
                    tables.check_judge_results.c.suspicious,
                    tables.check_judge_results.c.selected_match,
                    tables.check_judge_results.c.rationale,
                    tables.check_judge_results.c.confidence,
                    tables.check_judge_results.c.hit_count,
                )
            ).one()

        assert row.description == "React UI library"
        assert row.suspicious is True
        assert row.selected_match == "react"
        assert row.rationale == "Likely typo."
        assert row.confidence == "high"
        assert row.hit_count == 2
    finally:
        with context.engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL is required for repository integration tests",
)
def test_seed_run_repository_creates_and_completes_runs() -> None:
    schema = f"intel_test_{uuid.uuid4().hex[:12]}"
    context = RepositoryContext(
        database_url=os.environ["DATABASE_URL"],
        database_schema=schema,
    )
    repository = SeedRunRepository(context)
    tables = build_intelligence_tables(schema)

    with context.engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        tables.metadata.create_all(connection)

    try:
        run_id = repository.create(
            ecosystem="npm",
            operation="load",
            source="normalized_artifact",
            artifact_path="data/npm/normalized/npm-seed-records.ndjson.gz",
        )

        repository.complete(
            run_id=run_id,
            status="succeeded",
            records_seen=10,
            records_inserted=7,
            records_updated=2,
            records_skipped=1,
            error_summary=None,
        )

        with context.engine.connect() as connection:
            row = connection.execute(
                select(
                    tables.seed_runs.c.ecosystem,
                    tables.seed_runs.c.operation,
                    tables.seed_runs.c.status,
                    tables.seed_runs.c.source,
                    tables.seed_runs.c.artifact_path,
                    tables.seed_runs.c.records_seen,
                    tables.seed_runs.c.records_inserted,
                    tables.seed_runs.c.records_updated,
                    tables.seed_runs.c.records_skipped,
                    tables.seed_runs.c.finished_at,
                )
            ).one()

        assert row.ecosystem == "npm"
        assert row.operation == "load"
        assert row.status == "succeeded"
        assert row.source == "normalized_artifact"
        assert row.artifact_path == "data/npm/normalized/npm-seed-records.ndjson.gz"
        assert row.records_seen == 10
        assert row.records_inserted == 7
        assert row.records_updated == 2
        assert row.records_skipped == 1
        assert row.finished_at is not None
    finally:
        with context.engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
