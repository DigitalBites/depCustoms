"""add package embedding metadata hash

Revision ID: 20260422_0006
Revises: 20260422_0005
Create Date: 2026-04-22 02:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260422_0006"
down_revision = "20260422_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    schema = op.get_context().config.get_main_option("intelligence_db_schema")
    op.add_column(
        "package_embeddings",
        sa.Column(
            "metadata_hash",
            sa.Text(),
            nullable=False,
            server_default=sa.text("''"),
        ),
        schema=schema,
    )
    op.execute(
        sa.text(
            f"""
            UPDATE "{schema}".package_embeddings
            SET metadata_hash = source_record_hash
            """
        )
    )


def downgrade() -> None:
    schema = op.get_context().config.get_main_option("intelligence_db_schema")
    op.drop_column("package_embeddings", "metadata_hash", schema=schema)
