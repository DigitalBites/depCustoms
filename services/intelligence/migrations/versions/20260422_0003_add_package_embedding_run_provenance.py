"""add package embedding run provenance

Revision ID: 20260422_0003
Revises: 20260422_0002
Create Date: 2026-04-22 00:30:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260422_0003"
down_revision = "20260422_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    schema = op.get_context().config.get_main_option("intelligence_db_schema")

    op.add_column(
        "package_embeddings",
        sa.Column("created_by_run_id", sa.UUID(), nullable=True),
        schema=schema,
    )
    op.add_column(
        "package_embeddings",
        sa.Column("updated_by_run_id", sa.UUID(), nullable=True),
        schema=schema,
    )
    op.create_foreign_key(
        "package_embeddings_created_by_run_id_fkey",
        "package_embeddings",
        "seed_runs",
        ["created_by_run_id"],
        ["id"],
        source_schema=schema,
        referent_schema=schema,
    )
    op.create_foreign_key(
        "package_embeddings_updated_by_run_id_fkey",
        "package_embeddings",
        "seed_runs",
        ["updated_by_run_id"],
        ["id"],
        source_schema=schema,
        referent_schema=schema,
    )


def downgrade() -> None:
    schema = op.get_context().config.get_main_option("intelligence_db_schema")

    op.drop_constraint(
        "package_embeddings_updated_by_run_id_fkey",
        "package_embeddings",
        schema=schema,
        type_="foreignkey",
    )
    op.drop_constraint(
        "package_embeddings_created_by_run_id_fkey",
        "package_embeddings",
        schema=schema,
        type_="foreignkey",
    )
    op.drop_column("package_embeddings", "updated_by_run_id", schema=schema)
    op.drop_column("package_embeddings", "created_by_run_id", schema=schema)
