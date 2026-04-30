"""create intelligence schema baseline

Revision ID: 20260422_0008
Revises:
Create Date: 2026-04-22 11:30:00
"""

from __future__ import annotations

import logging

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import VECTOR
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

revision = "20260422_0008"
down_revision = None
branch_labels = None
depends_on = None

logger = logging.getLogger("uvicorn.error")


def upgrade() -> None:
    bind = op.get_bind()
    schema = op.get_context().config.get_main_option("intelligence_db_schema")

    logger.info("migration_20260422_0008_extensions_begin")
    bind.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
    bind.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    bind.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    logger.info("migration_20260422_0008_extensions_complete")
    logger.info("migration_20260422_0008_schema_begin")
    bind.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
    logger.info("migration_20260422_0008_schema_complete")

    logger.info("migration_20260422_0008_check_judge_results_begin")
    op.create_table(
        "check_judge_results",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("judge_model", sa.Text(), nullable=False),
        sa.Column("request_hash", sa.Text(), nullable=False),
        sa.Column("candidate_hash", sa.Text(), nullable=False),
        sa.Column("ecosystem", sa.Text(), nullable=False),
        sa.Column("package", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("suspicious", sa.Boolean(), nullable=False),
        sa.Column("selected_match", sa.Text(), nullable=True),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Text(), nullable=False),
        sa.Column(
            "hit_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("judge_model", "request_hash", "candidate_hash"),
        schema=schema,
    )
    logger.info("migration_20260422_0008_check_judge_results_complete")

    logger.info("migration_20260422_0008_check_query_embeddings_begin")
    op.create_table(
        "check_query_embeddings",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("embedding_model", sa.Text(), nullable=False),
        sa.Column("request_hash", sa.Text(), nullable=False),
        sa.Column("ecosystem", sa.Text(), nullable=False),
        sa.Column("package", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("request_text", sa.Text(), nullable=False),
        sa.Column("embedding", VECTOR(1536), nullable=False),
        sa.Column(
            "hit_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("embedding_model", "request_hash"),
        schema=schema,
    )
    logger.info("migration_20260422_0008_check_query_embeddings_complete")

    logger.info("migration_20260422_0008_seed_runs_begin")
    op.create_table(
        "seed_runs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("ecosystem", sa.Text(), nullable=False),
        sa.Column("operation", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=True),
        sa.Column("artifact_path", sa.Text(), nullable=True),
        sa.Column(
            "records_seen",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "records_inserted",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "records_updated",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "records_skipped",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("error_summary", sa.Text(), nullable=True),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        schema=schema,
    )
    logger.info("migration_20260422_0008_seed_runs_complete")

    logger.info("migration_20260422_0008_package_embeddings_begin")
    op.create_table(
        "package_embeddings",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("ecosystem", sa.Text(), nullable=False),
        sa.Column("package", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("embedding", VECTOR(1536), nullable=False),
        sa.Column("embedding_model", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("source_query", sa.Text(), nullable=True),
        sa.Column("source_rank", sa.Integer(), nullable=True),
        sa.Column("source_record_hash", sa.Text(), nullable=False),
        sa.Column("collected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "embedded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("created_by_run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_score_final", sa.Float(), nullable=True),
        sa.Column(
            "search_eligible",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "metadata_hash",
            sa.Text(),
            nullable=False,
            server_default=sa.text("''"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by_run_id"],
            [f"{schema}.seed_runs.id"],
            name="package_embeddings_created_by_run_id_fkey",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_run_id"],
            [f"{schema}.seed_runs.id"],
            name="package_embeddings_updated_by_run_id_fkey",
        ),
        sa.UniqueConstraint("ecosystem", "package"),
        schema=schema,
    )
    logger.info("migration_20260422_0008_package_embeddings_complete")

    logger.info("migration_20260422_0008_hnsw_index_begin")
    op.create_index(
        "package_embeddings_hnsw_idx",
        "package_embeddings",
        ["embedding"],
        schema=schema,
        postgresql_using="hnsw",
        postgresql_with={"m": 16, "ef_construction": 64},
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )
    logger.info("migration_20260422_0008_hnsw_index_complete")
    logger.info("migration_20260422_0008_trgm_index_begin")
    op.execute(
        sa.text(
            f"""
            CREATE INDEX IF NOT EXISTS ix_package_embeddings_package_name_trgm
            ON "{schema}".package_embeddings
            USING gin (
              (regexp_replace(lower(package), '[^a-z0-9]', '', 'g')) gin_trgm_ops
            )
            WHERE search_eligible = true
            """
        )
    )
    logger.info("migration_20260422_0008_trgm_index_complete")


def downgrade() -> None:
    schema = op.get_context().config.get_main_option("intelligence_db_schema")

    op.execute(
        sa.text(
            f'DROP INDEX IF EXISTS "{schema}".ix_package_embeddings_package_name_trgm'
        )
    )
    op.drop_index(
        "package_embeddings_hnsw_idx",
        table_name="package_embeddings",
        schema=schema,
    )
    op.drop_table("package_embeddings", schema=schema)
    op.drop_table("seed_runs", schema=schema)
    op.drop_table("check_query_embeddings", schema=schema)
    op.drop_table("check_judge_results", schema=schema)
    op.execute(sa.text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
