"""create intelligence schema

Revision ID: 20260421_0001
Revises:
Create Date: 2026-04-21 00:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import VECTOR
from sqlalchemy import text

revision = "20260421_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    schema = op.get_context().config.get_main_option("intelligence_db_schema")

    bind.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
    bind.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    bind.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
    op.create_table(
        "package_embeddings",
        sa.Column(
            "id",
            sa.UUID(),
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
        sa.UniqueConstraint("ecosystem", "package"),
        schema=schema,
    )
    op.create_table(
        "seed_runs",
        sa.Column(
            "id",
            sa.UUID(),
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
    op.create_index(
        "package_embeddings_hnsw_idx",
        "package_embeddings",
        ["embedding"],
        schema=schema,
        postgresql_using="hnsw",
        postgresql_with={"m": 16, "ef_construction": 64},
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )


def downgrade() -> None:
    bind = op.get_bind()
    schema = op.get_context().config.get_main_option("intelligence_db_schema")

    op.drop_index(
        "package_embeddings_hnsw_idx",
        table_name="package_embeddings",
        schema=schema,
    )
    op.drop_table("seed_runs", schema=schema)
    op.drop_table("package_embeddings", schema=schema)
    bind.execute(text(f'DROP SCHEMA IF EXISTS "{schema}"'))
