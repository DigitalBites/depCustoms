from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import insert, select, text

from app.core.database_schema import build_intelligence_tables
from app.models.seed_records import NormalizedSeedRecord
from app.repositories.base import RepositoryContext
from app.repositories.package_embeddings import PackageEmbeddingRepository


def _vector(value: float) -> list[float]:
    return [value] * 1536


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL is required for repository integration tests",
)
def test_upsert_seed_records_does_not_touch_absent_rows() -> None:
    schema = f"intel_test_{uuid.uuid4().hex[:12]}"
    context = RepositoryContext(
        database_url=os.environ["DATABASE_URL"],
        database_schema=schema,
    )
    repository = PackageEmbeddingRepository(context)
    tables = build_intelligence_tables(schema)

    with context.engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        tables.metadata.create_all(connection)

    try:
        with context.engine.begin() as connection:
            first_run_id = connection.execute(
                insert(tables.seed_runs)
                .values(
                    ecosystem="npm",
                    operation="load",
                    status="succeeded",
                    source="normalized_artifact",
                    artifact_path="test/first.ndjson.gz",
                )
                .returning(tables.seed_runs.c.id)
            ).scalar_one()
            second_run_id = connection.execute(
                insert(tables.seed_runs)
                .values(
                    ecosystem="npm",
                    operation="load",
                    status="succeeded",
                    source="normalized_artifact",
                    artifact_path="test/second.ndjson.gz",
                )
                .returning(tables.seed_runs.c.id)
            ).scalar_one()

        initial_records = [
            NormalizedSeedRecord(
                ecosystem="npm",
                package="react",
                description=(
                    "React is a JavaScript library for building user interfaces."
                ),
                version="19.0.0",
                source="seed_npm",
                source_query="react",
                source_rank=1,
                popularity_signal={"score_final": 0.99},
                collected_at=datetime(2026, 4, 22, tzinfo=UTC),
                source_record_hash="a" * 64,
            ),
            NormalizedSeedRecord(
                ecosystem="npm",
                package="commander",
                description="The complete solution for node.js command-line programs.",
                version="12.0.0",
                source="seed_npm",
                source_query="commander",
                source_rank=1,
                popularity_signal={"score_final": 0.88},
                collected_at=datetime(2026, 4, 22, tzinfo=UTC),
                source_record_hash="b" * 64,
            ),
        ]

        inserted, updated, skipped = repository.upsert_seed_records(
            records=initial_records,
            embeddings_by_package={
                ("npm", "react"): _vector(0.1),
                ("npm", "commander"): _vector(0.2),
            },
            embedding_model="openai/text-embedding-3-small",
            run_id=str(first_run_id),
        )

        assert (inserted, updated, skipped) == (2, 0, 0)

        second_run_records = [
            NormalizedSeedRecord(
                ecosystem="npm",
                package="react",
                description=(
                    "React is a JavaScript library for building user interfaces."
                ),
                version="19.0.0",
                source="seed_npm",
                source_query="react",
                source_rank=1,
                popularity_signal={"score_final": 0.99},
                collected_at=datetime(2026, 4, 23, tzinfo=UTC),
                source_record_hash="a" * 64,
            )
        ]

        inserted, updated, skipped = repository.upsert_seed_records(
            records=second_run_records,
            embeddings_by_package={},
            embedding_model="openai/text-embedding-3-small",
            run_id=str(second_run_id),
        )

        assert (inserted, updated, skipped) == (0, 0, 1)

        with context.engine.connect() as connection:
            rows = connection.execute(
                select(
                    tables.package_embeddings.c.package,
                    tables.package_embeddings.c.active,
                    tables.package_embeddings.c.source_record_hash,
                    tables.package_embeddings.c.created_by_run_id,
                    tables.package_embeddings.c.updated_by_run_id,
                ).order_by(tables.package_embeddings.c.package)
            ).all()

        assert len(rows) == 2
        assert rows[0].package == "commander"
        assert rows[0].active is True
        assert rows[0].source_record_hash == "b" * 64
        assert str(rows[0].created_by_run_id) == str(first_run_id)
        assert str(rows[0].updated_by_run_id) == str(first_run_id)
        assert rows[1].package == "react"
        assert rows[1].active is True
        assert rows[1].source_record_hash == "a" * 64
        assert str(rows[1].created_by_run_id) == str(first_run_id)
        assert str(rows[1].updated_by_run_id) == str(first_run_id)
    finally:
        with context.engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL is required for repository integration tests",
)
def test_search_neighbors_filters_non_search_eligible_rows() -> None:
    schema = f"intel_test_{uuid.uuid4().hex[:12]}"
    context = RepositoryContext(
        database_url=os.environ["DATABASE_URL"],
        database_schema=schema,
    )
    repository = PackageEmbeddingRepository(context)
    tables = build_intelligence_tables(schema)

    with context.engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        tables.metadata.create_all(connection)
        run_id = connection.execute(
            insert(tables.seed_runs)
            .values(
                ecosystem="npm",
                operation="load",
                status="succeeded",
                source="normalized_artifact",
                artifact_path="test/search.ndjson.gz",
            )
            .returning(tables.seed_runs.c.id)
        ).scalar_one()

    try:
        records = [
            NormalizedSeedRecord(
                ecosystem="npm",
                package="lodash",
                description="Lodash modular utilities.",
                version="4.18.1",
                source="seed_npm",
                source_query="lodash",
                source_rank=1,
                popularity_signal={"score_final": 2765.1655},
                collected_at=datetime(2026, 4, 22, tzinfo=UTC),
                source_record_hash="c" * 64,
            ),
            NormalizedSeedRecord(
                ecosystem="npm",
                package="lodas",
                description="lodash typo helper",
                version="1.2.0",
                source="seed_npm",
                source_query="lodash",
                source_rank=243,
                popularity_signal={"score_final": 134.272},
                collected_at=datetime(2026, 4, 22, tzinfo=UTC),
                source_record_hash="d" * 64,
            ),
        ]

        inserted, updated, skipped = repository.upsert_seed_records(
            records=records,
            embeddings_by_package={
                ("npm", "lodash"): _vector(0.1),
                ("npm", "lodas"): _vector(0.1),
            },
            embedding_model="openai/text-embedding-3-small",
            run_id=str(run_id),
        )

        assert (inserted, updated, skipped) == (2, 0, 0)

        neighbors = repository.search_neighbors(
            ecosystem="npm",
            embedding=_vector(0.1),
            top_k=5,
        )
        lexical_candidates = repository.search_lexical_candidates(
            ecosystem="npm",
            package="lodahs",
            embedding=_vector(0.1),
            top_k=5,
        )

        assert [neighbor.package for neighbor in neighbors] == ["lodash"]
        assert [neighbor.package for neighbor in lexical_candidates] == ["lodash"]

        with context.engine.connect() as connection:
            rows = connection.execute(
                select(
                    tables.package_embeddings.c.package,
                    tables.package_embeddings.c.search_eligible,
                ).order_by(tables.package_embeddings.c.package)
            ).all()

        assert rows[0].package == "lodas"
        assert rows[0].search_eligible is False
        assert rows[1].package == "lodash"
        assert rows[1].search_eligible is True
    finally:
        with context.engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL is required for repository integration tests",
)
def test_find_exact_package_and_fetch_existing_records_edge_cases() -> None:
    schema = f"intel_test_{uuid.uuid4().hex[:12]}"
    context = RepositoryContext(
        database_url=os.environ["DATABASE_URL"],
        database_schema=schema,
    )
    repository = PackageEmbeddingRepository(context)
    tables = build_intelligence_tables(schema)

    with context.engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        tables.metadata.create_all(connection)
        run_id = connection.execute(
            insert(tables.seed_runs)
            .values(
                ecosystem="npm",
                operation="load",
                status="succeeded",
                source="normalized_artifact",
                artifact_path="test/exact.ndjson.gz",
            )
            .returning(tables.seed_runs.c.id)
        ).scalar_one()

    try:
        assert repository.fetch_existing_seed_records([]) == {}
        assert repository.find_exact_package(ecosystem="npm", package="missing") is None

        record = NormalizedSeedRecord(
            ecosystem="npm",
            package="preact",
            description="Fast 3kb React-compatible Virtual DOM library.",
            version="10.23.0",
            source="seed_npm",
            source_query="preact",
            source_rank=229,
            popularity_signal={"score_final": 149.18767},
            collected_at=datetime(2026, 4, 22, tzinfo=UTC),
            source_record_hash="e" * 64,
        )

        inserted, updated, skipped = repository.upsert_seed_records(
            records=[record],
            embeddings_by_package={("npm", "preact"): _vector(0.3)},
            embedding_model="openai/text-embedding-3-small",
            run_id=str(run_id),
        )

        assert (inserted, updated, skipped) == (1, 0, 0)

        exact = repository.find_exact_package(ecosystem="npm", package="preact")

        assert exact is not None
        assert exact.package == "preact"
        assert exact.similarity_score == 1.0

        existing = repository.fetch_existing_seed_records([record])

        assert existing[("npm", "preact")].source_record_hash == "e" * 64
    finally:
        with context.engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL is required for repository integration tests",
)
def test_has_adjacent_name_in_corpus_and_missing_embedding_error() -> None:
    schema = f"intel_test_{uuid.uuid4().hex[:12]}"
    context = RepositoryContext(
        database_url=os.environ["DATABASE_URL"],
        database_schema=schema,
    )
    repository = PackageEmbeddingRepository(context)
    tables = build_intelligence_tables(schema)

    with context.engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        tables.metadata.create_all(connection)
        run_id = connection.execute(
            insert(tables.seed_runs)
            .values(
                ecosystem="npm",
                operation="load",
                status="succeeded",
                source="normalized_artifact",
                artifact_path="test/adjacent.ndjson.gz",
            )
            .returning(tables.seed_runs.c.id)
        ).scalar_one()

    try:
        record = NormalizedSeedRecord(
            ecosystem="npm",
            package="react",
            description="React is a JavaScript library for building user interfaces.",
            version="19.0.0",
            source="seed_npm",
            source_query="react",
            source_rank=1,
            popularity_signal={"score_final": 2314.9753},
            collected_at=datetime(2026, 4, 22, tzinfo=UTC),
            source_record_hash="f" * 64,
        )

        repository.upsert_seed_records(
            records=[record],
            embeddings_by_package={("npm", "react"): _vector(0.1)},
            embedding_model="openai/text-embedding-3-small",
            run_id=str(run_id),
        )

        assert repository.has_adjacent_name_in_corpus(
            ecosystem="npm",
            package="recat",
        ) is True
        assert repository.has_adjacent_name_in_corpus(
            ecosystem="npm",
            package="recat",
            exclude_package="react",
        ) is False
        assert repository.has_adjacent_name_in_corpus(
            ecosystem="npm",
            package="!!!",
        ) is False

        missing_embedding_record = NormalizedSeedRecord(
            ecosystem="npm",
            package="axios",
            description="Promise based HTTP client.",
            version="1.8.0",
            source="seed_npm",
            source_query="axios",
            source_rank=2,
            popularity_signal={"score_final": 2100.0},
            collected_at=datetime(2026, 4, 22, tzinfo=UTC),
            source_record_hash="a" * 64,
        )

        with pytest.raises(
            ValueError,
            match="missing embedding for package 'npm:axios'",
        ):
            repository.upsert_seed_records(
                records=[missing_embedding_record],
                embeddings_by_package={},
                embedding_model="openai/text-embedding-3-small",
                run_id=str(run_id),
            )
    finally:
        with context.engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL is required for repository integration tests",
)
def test_upsert_seed_records_updates_metadata_without_reembedding() -> None:
    schema = f"intel_test_{uuid.uuid4().hex[:12]}"
    context = RepositoryContext(
        database_url=os.environ["DATABASE_URL"],
        database_schema=schema,
    )
    repository = PackageEmbeddingRepository(context)
    tables = build_intelligence_tables(schema)

    with context.engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        tables.metadata.create_all(connection)
        first_run_id = connection.execute(
            insert(tables.seed_runs)
            .values(
                ecosystem="npm",
                operation="load",
                status="succeeded",
                source="normalized_artifact",
                artifact_path="test/metadata-first.ndjson.gz",
            )
            .returning(tables.seed_runs.c.id)
        ).scalar_one()
        second_run_id = connection.execute(
            insert(tables.seed_runs)
            .values(
                ecosystem="npm",
                operation="load",
                status="succeeded",
                source="normalized_artifact",
                artifact_path="test/metadata-second.ndjson.gz",
            )
            .returning(tables.seed_runs.c.id)
        ).scalar_one()

    try:
        initial_record = NormalizedSeedRecord(
            ecosystem="npm",
            package="preact",
            description="Fast 3kb React-compatible Virtual DOM library.",
            version="10.0.0",
            source="seed_npm",
            source_query="preact",
            source_rank=229,
            popularity_signal={"score_final": 149.18767},
            collected_at=datetime(2026, 4, 22, tzinfo=UTC),
            source_record_hash="e" * 64,
        )
        inserted, updated, skipped = repository.upsert_seed_records(
            records=[initial_record],
            embeddings_by_package={("npm", "preact"): _vector(0.3)},
            embedding_model="openai/text-embedding-3-small",
            run_id=str(first_run_id),
        )
        assert (inserted, updated, skipped) == (1, 0, 0)

        with context.engine.connect() as connection:
            initial_row = connection.execute(
                select(
                    tables.package_embeddings.c.embedding,
                    tables.package_embeddings.c.embedded_at,
                    tables.package_embeddings.c.search_eligible,
                ).where(tables.package_embeddings.c.package == "preact")
            ).one()

        metadata_only_record = NormalizedSeedRecord(
            ecosystem="npm",
            package="preact",
            description="Fast 3kb React-compatible Virtual DOM library.",
            version="10.0.0",
            source="seed_npm",
            source_query="preact",
            source_rank=50,
            popularity_signal={"score_final": 300.0},
            collected_at=datetime(2026, 4, 23, tzinfo=UTC),
            source_record_hash="e" * 64,
        )
        inserted, updated, skipped = repository.upsert_seed_records(
            records=[metadata_only_record],
            embeddings_by_package={},
            embedding_model="openai/text-embedding-3-small",
            run_id=str(second_run_id),
        )
        assert (inserted, updated, skipped) == (0, 1, 0)

        with context.engine.connect() as connection:
            updated_row = connection.execute(
                select(
                    tables.package_embeddings.c.embedding,
                    tables.package_embeddings.c.embedded_at,
                    tables.package_embeddings.c.source_rank,
                    tables.package_embeddings.c.source_score_final,
                    tables.package_embeddings.c.search_eligible,
                    tables.package_embeddings.c.updated_by_run_id,
                ).where(tables.package_embeddings.c.package == "preact")
            ).one()

        assert list(updated_row.embedding) == list(initial_row.embedding)
        assert updated_row.embedded_at == initial_row.embedded_at
        assert updated_row.source_rank == 50
        assert float(updated_row.source_score_final) == 300.0
        assert updated_row.search_eligible is True
        assert str(updated_row.updated_by_run_id) == str(second_run_id)
    finally:
        with context.engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
