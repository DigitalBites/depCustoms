"""add package embedding search eligibility

Revision ID: 20260422_0005
Revises: 20260422_0004
Create Date: 2026-04-22 01:30:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision = "20260422_0005"
down_revision = "20260422_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    schema = op.get_context().config.get_main_option("intelligence_db_schema")
    op.add_column(
        "package_embeddings",
        sa.Column(
            "search_eligible",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        schema=schema,
    )
    op.execute(
        text(
            f"""
            UPDATE "{schema}".package_embeddings
            SET search_eligible = CASE
                WHEN ecosystem = 'npm' THEN (
                    (
                        COALESCE(source_rank, 2147483647) <= 100
                        OR COALESCE(source_score_final, 0) >= 250
                    )
                    AND COALESCE(lower(description), '') NOT LIKE '%typo%'
                )
                ELSE true
            END
            """
        )
    )


def downgrade() -> None:
    schema = op.get_context().config.get_main_option("intelligence_db_schema")
    op.drop_column("package_embeddings", "search_eligible", schema=schema)
