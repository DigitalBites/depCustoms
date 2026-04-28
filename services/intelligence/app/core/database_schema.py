from __future__ import annotations

from dataclasses import dataclass

from pgvector.sqlalchemy import VECTOR
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    MetaData,
    Table,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID


@dataclass(frozen=True)
class IntelligenceTables:
    metadata: MetaData
    check_query_embeddings: Table
    check_judge_results: Table
    package_embeddings: Table
    seed_runs: Table


def build_intelligence_tables(schema: str) -> IntelligenceTables:
    metadata = MetaData(schema=schema)
    check_query_embeddings = Table(
        "check_query_embeddings",
        metadata,
        Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=text("gen_random_uuid()"),
        ),
        Column("embedding_model", Text, nullable=False),
        Column("request_hash", Text, nullable=False),
        Column("ecosystem", Text, nullable=False),
        Column("package", Text, nullable=False),
        Column("description", Text, nullable=True),
        Column("request_text", Text, nullable=False),
        Column("embedding", VECTOR(1536), nullable=False),
        Column("hit_count", Integer, nullable=False, server_default=text("1")),
        Column(
            "created_at",
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
        Column(
            "last_seen_at",
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
        UniqueConstraint("embedding_model", "request_hash"),
    )
    check_judge_results = Table(
        "check_judge_results",
        metadata,
        Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=text("gen_random_uuid()"),
        ),
        Column("judge_model", Text, nullable=False),
        Column("request_hash", Text, nullable=False),
        Column("candidate_hash", Text, nullable=False),
        Column("ecosystem", Text, nullable=False),
        Column("package", Text, nullable=False),
        Column("description", Text, nullable=True),
        Column("suspicious", Boolean, nullable=False),
        Column("selected_match", Text, nullable=True),
        Column("rationale", Text, nullable=False),
        Column("confidence", Text, nullable=False),
        Column("hit_count", Integer, nullable=False, server_default=text("1")),
        Column(
            "created_at",
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
        Column(
            "last_seen_at",
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
        UniqueConstraint("judge_model", "request_hash", "candidate_hash"),
    )
    package_embeddings = Table(
        "package_embeddings",
        metadata,
        Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=text("gen_random_uuid()"),
        ),
        Column("ecosystem", Text, nullable=False),
        Column("package", Text, nullable=False),
        Column("description", Text, nullable=True),
        Column("embedding", VECTOR(1536), nullable=False),
        Column("embedding_model", Text, nullable=False),
        Column("source", Text, nullable=False),
        Column("source_query", Text, nullable=True),
        Column("source_rank", Integer, nullable=True),
        Column("source_score_final", Float, nullable=True),
        Column(
            "search_eligible",
            Boolean,
            nullable=False,
            server_default=text("true"),
        ),
        Column("metadata_hash", Text, nullable=False, server_default=text("''")),
        Column("source_record_hash", Text, nullable=False),
        Column("collected_at", DateTime(timezone=True), nullable=True),
        Column(
            "created_by_run_id",
            UUID(as_uuid=True),
            ForeignKey(f"{schema}.seed_runs.id"),
            nullable=True,
        ),
        Column(
            "updated_by_run_id",
            UUID(as_uuid=True),
            ForeignKey(f"{schema}.seed_runs.id"),
            nullable=True,
        ),
        Column(
            "embedded_at",
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
        Column(
            "active",
            Boolean,
            nullable=False,
            server_default=text("true"),
        ),
        Column(
            "created_at",
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
        Column(
            "updated_at",
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
        UniqueConstraint("ecosystem", "package"),
    )
    seed_runs = Table(
        "seed_runs",
        metadata,
        Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=text("gen_random_uuid()"),
        ),
        Column("ecosystem", Text, nullable=False),
        Column("operation", Text, nullable=False),
        Column("status", Text, nullable=False),
        Column("source", Text, nullable=True),
        Column("artifact_path", Text, nullable=True),
        Column("records_seen", Integer, nullable=False, server_default=text("0")),
        Column("records_inserted", Integer, nullable=False, server_default=text("0")),
        Column("records_updated", Integer, nullable=False, server_default=text("0")),
        Column("records_skipped", Integer, nullable=False, server_default=text("0")),
        Column("error_summary", Text, nullable=True),
        Column(
            "started_at",
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
        Column("finished_at", DateTime(timezone=True), nullable=True),
    )
    return IntelligenceTables(
        metadata=metadata,
        check_query_embeddings=check_query_embeddings,
        check_judge_results=check_judge_results,
        package_embeddings=package_embeddings,
        seed_runs=seed_runs,
    )
