from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert

from .base import RepositoryContext


@dataclass(frozen=True)
class CachedQueryEmbedding:
    embedding: list[float]


@dataclass
class CheckQueryEmbeddingRepository:
    context: RepositoryContext

    def fetch_embedding(
        self,
        *,
        embedding_model: str,
        request_hash: str,
    ) -> list[float] | None:
        check_query_embeddings = self.context.tables.check_query_embeddings
        query = (
            select(check_query_embeddings.c.embedding)
            .where(check_query_embeddings.c.embedding_model == embedding_model)
            .where(check_query_embeddings.c.request_hash == request_hash)
        )

        row = self.context.fetch_one(query)
        if row is None:
            return None
        return [float(value) for value in row.embedding]

    def record_embedding(
        self,
        *,
        embedding_model: str,
        request_hash: str,
        ecosystem: str,
        package: str,
        description: str | None,
        request_text: str,
        embedding: list[float],
    ) -> None:
        check_query_embeddings = self.context.tables.check_query_embeddings
        now = datetime.now(tz=UTC)
        statement = insert(check_query_embeddings).values(
            embedding_model=embedding_model,
            request_hash=request_hash,
            ecosystem=ecosystem,
            package=package,
            description=description,
            request_text=request_text,
            embedding=embedding,
            hit_count=1,
            created_at=now,
            last_seen_at=now,
        )
        statement = statement.on_conflict_do_update(
            index_elements=[
                check_query_embeddings.c.embedding_model,
                check_query_embeddings.c.request_hash,
            ],
            set_={
                "hit_count": check_query_embeddings.c.hit_count + 1,
                "last_seen_at": func.now(),
                "description": statement.excluded.description,
                "request_text": statement.excluded.request_text,
                "embedding": statement.excluded.embedding,
            },
        )

        self.context.execute(statement)

    def bump_hit_count(
        self,
        *,
        embedding_model: str,
        request_hash: str,
    ) -> None:
        check_query_embeddings = self.context.tables.check_query_embeddings
        statement = (
            update(check_query_embeddings)
            .where(check_query_embeddings.c.embedding_model == embedding_model)
            .where(check_query_embeddings.c.request_hash == request_hash)
            .values(
                hit_count=check_query_embeddings.c.hit_count + 1,
                last_seen_at=func.now(),
            )
        )

        self.context.execute(statement)
