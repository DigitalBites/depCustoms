"""add package embedding source score final

Revision ID: 20260422_0004
Revises: 20260422_0003
Create Date: 2026-04-22 01:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260422_0004"
down_revision = "20260422_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    schema = op.get_context().config.get_main_option("intelligence_db_schema")
    op.add_column(
        "package_embeddings",
        sa.Column("source_score_final", sa.Float(), nullable=True),
        schema=schema,
    )


def downgrade() -> None:
    schema = op.get_context().config.get_main_option("intelligence_db_schema")
    op.drop_column("package_embeddings", "source_score_final", schema=schema)
