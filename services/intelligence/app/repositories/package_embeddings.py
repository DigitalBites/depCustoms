from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Text, cast, func, literal, select, update
from sqlalchemy.dialects.postgresql import insert

from app.domain.corpus_policy import get_corpus_policy
from app.domain.package_names import (
    looks_like_typo_variant,
    normalize_package_name_for_similarity,
)
from app.models.seed_records import NormalizedSeedRecord, metadata_hash_for_seed_record
from app.schemas import Neighbor

from .base import RepositoryContext


@dataclass(frozen=True)
class ExistingSeedRecordState:
    source_record_hash: str
    metadata_hash: str


@dataclass
class PackageEmbeddingRepository:
    context: RepositoryContext

    def search_neighbors(
        self,
        ecosystem: str,
        embedding: list[float],
        top_k: int,
    ) -> list[Neighbor]:
        package_embeddings = self.context.tables.package_embeddings
        distance = package_embeddings.c.embedding.cosine_distance(embedding)
        query = (
            select(
                package_embeddings.c.package,
                package_embeddings.c.description,
                package_embeddings.c.source_rank,
                package_embeddings.c.source_score_final,
                package_embeddings.c.search_eligible,
                (1 - distance).label("similarity_score"),
            )
            .where(package_embeddings.c.ecosystem == ecosystem)
            .where(package_embeddings.c.search_eligible.is_(True))
            .order_by(distance)
            .limit(top_k)
        )

        rows = self.context.fetch_all(query)
        return [
            Neighbor(
                package=str(row.package),
                description=row.description,
                similarity_score=float(row.similarity_score),
                source_rank=(
                    int(row.source_rank) if row.source_rank is not None else None
                ),
                source_score_final=(
                    float(row.source_score_final)
                    if row.source_score_final is not None
                    else None
                ),
                search_eligible=bool(row.search_eligible),
            )
            for row in rows
        ]

    def search_lexical_candidates(
        self,
        *,
        ecosystem: str,
        package: str,
        embedding: list[float],
        top_k: int,
    ) -> list[Neighbor]:
        normalized_query = normalize_package_name_for_similarity(package)
        if not normalized_query:
            return []

        package_embeddings = self.context.tables.package_embeddings
        normalized_package_expr = func.regexp_replace(
            func.lower(package_embeddings.c.package),
            r"[^a-z0-9]",
            "",
            "g",
        )
        normalized_query_text = cast(literal(normalized_query), Text)
        similarity_expr = func.similarity(
            normalized_package_expr,
            normalized_query_text,
        )
        semantic_distance = package_embeddings.c.embedding.cosine_distance(embedding)
        min_length = max(1, len(normalized_query) - 3)
        max_length = len(normalized_query) + 3
        query = (
            select(
                package_embeddings.c.package,
                package_embeddings.c.description,
                package_embeddings.c.source_rank,
                package_embeddings.c.source_score_final,
                package_embeddings.c.search_eligible,
                (1 - semantic_distance).label("similarity_score"),
            )
            .where(package_embeddings.c.ecosystem == ecosystem)
            .where(package_embeddings.c.search_eligible.is_(True))
            .where(package_embeddings.c.package != package)
            .where(func.length(normalized_package_expr) >= min_length)
            .where(func.length(normalized_package_expr) <= max_length)
            .where(normalized_package_expr.op("%")(normalized_query_text))
            .order_by(similarity_expr.desc())
            .limit(top_k)
        )

        rows = self.context.fetch_all(query)
        return [
            Neighbor(
                package=str(row.package),
                description=row.description,
                similarity_score=float(row.similarity_score),
                source_rank=(
                    int(row.source_rank) if row.source_rank is not None else None
                ),
                source_score_final=(
                    float(row.source_score_final)
                    if row.source_score_final is not None
                    else None
                ),
                search_eligible=bool(row.search_eligible),
            )
            for row in rows
        ]

    def find_exact_package(
        self,
        *,
        ecosystem: str,
        package: str,
    ) -> Neighbor | None:
        package_embeddings = self.context.tables.package_embeddings
        query = (
            select(
                package_embeddings.c.package,
                package_embeddings.c.description,
                package_embeddings.c.source_rank,
                package_embeddings.c.source_score_final,
                package_embeddings.c.search_eligible,
            )
            .where(package_embeddings.c.ecosystem == ecosystem)
            .where(package_embeddings.c.package == package)
            .limit(1)
        )

        row = self.context.fetch_one_or_none(query)
        if row is None:
            return None

        return Neighbor(
            package=str(row.package),
            description=row.description,
            similarity_score=1.0,
            source_rank=int(row.source_rank) if row.source_rank is not None else None,
            source_score_final=(
                float(row.source_score_final)
                if row.source_score_final is not None
                else None
            ),
            search_eligible=bool(row.search_eligible),
        )

    def has_adjacent_name_in_corpus(
        self,
        *,
        ecosystem: str,
        package: str,
        exclude_package: str | None = None,
    ) -> bool:
        normalized = normalize_package_name_for_similarity(package)
        if not normalized:
            return False

        package_embeddings = self.context.tables.package_embeddings
        min_length = max(1, len(normalized) - 2)
        max_length = len(normalized) + 2
        normalized_package_expr = func.regexp_replace(
            package_embeddings.c.package,
            r"[^a-z0-9]",
            "",
            "g",
        )
        query = (
            select(package_embeddings.c.package)
            .where(package_embeddings.c.ecosystem == ecosystem)
            .where(package_embeddings.c.search_eligible.is_(True))
            .where(func.length(normalized_package_expr) >= min_length)
            .where(func.length(normalized_package_expr) <= max_length)
        )

        rows = self.context.fetch_all(query)
        for row in rows:
            candidate = str(row.package)
            if exclude_package is not None and candidate == exclude_package:
                continue
            if candidate == package:
                continue
            if looks_like_typo_variant(package, candidate):
                return True
        return False

    def fetch_existing_seed_records(
        self,
        records: list[NormalizedSeedRecord],
    ) -> dict[tuple[str, str], ExistingSeedRecordState]:
        if not records:
            return {}

        package_embeddings = self.context.tables.package_embeddings
        ecosystems = sorted({record.ecosystem for record in records})
        packages = sorted({record.package for record in records})
        query = (
            select(
                package_embeddings.c.ecosystem,
                package_embeddings.c.package,
                package_embeddings.c.source_record_hash,
                package_embeddings.c.metadata_hash,
            )
            .where(package_embeddings.c.ecosystem.in_(ecosystems))
            .where(package_embeddings.c.package.in_(packages))
        )

        rows = self.context.fetch_all(query)
        return {
            (str(row.ecosystem), str(row.package)): ExistingSeedRecordState(
                source_record_hash=str(row.source_record_hash),
                metadata_hash=str(row.metadata_hash),
            )
            for row in rows
        }

    def upsert_seed_records(
        self,
        records: list[NormalizedSeedRecord],
        embeddings_by_package: dict[tuple[str, str], list[float]],
        embedding_model: str,
        run_id: str,
    ) -> tuple[int, int, int]:
        if not records:
            return (0, 0, 0)

        package_embeddings = self.context.tables.package_embeddings
        existing_by_key = self.fetch_existing_seed_records(records)
        inserted = 0
        updated = 0
        skipped = 0
        now = datetime.now(tz=UTC)

        # Refresh is additive plus selective updates. Only the records present in this
        # load are touched; rows absent from the current seed artifact are not
        # deactivated or deleted here.
        with self.context.engine.begin() as connection:
            for record in records:
                key = (record.ecosystem, record.package)
                existing_state = existing_by_key.get(key)
                search_eligible = get_corpus_policy(
                    record.ecosystem
                ).is_search_eligible(record)
                metadata_hash = metadata_hash_for_seed_record(
                    record,
                    search_eligible=search_eligible,
                )
                source_hash_matches = (
                    existing_state is not None
                    and existing_state.source_record_hash == record.source_record_hash
                )
                metadata_hash_matches = (
                    existing_state is not None
                    and existing_state.metadata_hash == metadata_hash
                )
                if source_hash_matches and metadata_hash_matches:
                    skipped += 1
                    continue
                if existing_state is None:
                    inserted += 1
                else:
                    updated += 1

                if source_hash_matches:
                    metadata_statement = (
                        update(package_embeddings)
                        .where(package_embeddings.c.ecosystem == record.ecosystem)
                        .where(package_embeddings.c.package == record.package)
                        .values(
                            source=record.source,
                            source_query=record.source_query,
                            source_rank=record.source_rank,
                            source_score_final=record.popularity_signal.get(
                                "score_final"
                            ),
                            search_eligible=search_eligible,
                            metadata_hash=metadata_hash,
                            collected_at=record.collected_at,
                            updated_by_run_id=UUID(run_id),
                            active=True,
                            updated_at=func.now(),
                        )
                    )
                    connection.execute(metadata_statement)
                    continue

                embedding = embeddings_by_package.get(
                    (record.ecosystem, record.package)
                )
                if embedding is None:
                    raise ValueError(
                        "missing embedding for package "
                        f"'{record.ecosystem}:{record.package}'"
                    )

                statement = insert(package_embeddings).values(
                    ecosystem=record.ecosystem,
                    package=record.package,
                    description=record.description,
                    embedding=embedding,
                    embedding_model=embedding_model,
                    source=record.source,
                    source_query=record.source_query,
                    source_rank=record.source_rank,
                    source_score_final=record.popularity_signal.get("score_final"),
                    search_eligible=search_eligible,
                    metadata_hash=metadata_hash,
                    source_record_hash=record.source_record_hash,
                    collected_at=record.collected_at,
                    created_by_run_id=UUID(run_id),
                    updated_by_run_id=UUID(run_id),
                    embedded_at=now,
                    active=True,
                    updated_at=now,
                )
                statement = statement.on_conflict_do_update(
                    index_elements=[
                        package_embeddings.c.ecosystem,
                        package_embeddings.c.package,
                    ],
                    set_={
                        "description": statement.excluded.description,
                        "embedding": statement.excluded.embedding,
                        "embedding_model": statement.excluded.embedding_model,
                        "source": statement.excluded.source,
                        "source_query": statement.excluded.source_query,
                        "source_rank": statement.excluded.source_rank,
                        "source_score_final": statement.excluded.source_score_final,
                        "search_eligible": statement.excluded.search_eligible,
                        "metadata_hash": statement.excluded.metadata_hash,
                        "source_record_hash": statement.excluded.source_record_hash,
                        "collected_at": statement.excluded.collected_at,
                        "updated_by_run_id": UUID(run_id),
                        "embedded_at": func.now(),
                        "active": True,
                        "updated_at": func.now(),
                    },
                )
                connection.execute(statement)

        return (inserted, updated, skipped)
