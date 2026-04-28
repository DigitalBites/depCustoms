"""add package name trigram index

Revision ID: 20260422_0007
Revises: 20260422_0006
Create Date: 2026-04-22 03:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260422_0007"
down_revision = "20260422_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    schema = op.get_context().config.get_main_option("intelligence_db_schema")
    op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
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


def downgrade() -> None:
    schema = op.get_context().config.get_main_option("intelligence_db_schema")
    op.execute(
        sa.text(
            f'DROP INDEX IF EXISTS "{schema}".ix_package_embeddings_package_name_trgm'
        )
    )
