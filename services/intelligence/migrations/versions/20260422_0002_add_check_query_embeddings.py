"""add check query embeddings cache

Revision ID: 20260422_0002
Revises: 20260421_0001
Create Date: 2026-04-22 00:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import VECTOR

revision = "20260422_0002"
down_revision = "20260421_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    schema = op.get_context().config.get_main_option("intelligence_db_schema")

    op.create_table(
        "check_query_embeddings",
        sa.Column(
            "id",
            sa.UUID(),
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


def downgrade() -> None:
    schema = op.get_context().config.get_main_option("intelligence_db_schema")
    op.drop_table("check_query_embeddings", schema=schema)
