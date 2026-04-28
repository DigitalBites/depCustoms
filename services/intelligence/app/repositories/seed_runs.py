from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, insert, update

from .base import RepositoryContext


@dataclass
class SeedRunRepository:
    context: RepositoryContext

    def create(
        self,
        ecosystem: str,
        operation: str,
        source: str,
        artifact_path: str | None,
    ) -> str:
        seed_runs = self.context.tables.seed_runs
        query = (
            insert(seed_runs)
            .values(
                ecosystem=ecosystem,
                operation=operation,
                status="running",
                source=source,
                artifact_path=artifact_path,
            )
            .returning(seed_runs.c.id)
        )

        run_id = self.context.execute_scalar(query)
        return str(run_id)

    def complete(
        self,
        run_id: str,
        status: str,
        records_seen: int,
        records_inserted: int,
        records_updated: int,
        records_skipped: int,
        error_summary: str | None = None,
    ) -> None:
        seed_runs = self.context.tables.seed_runs
        query = (
            update(seed_runs)
            .where(seed_runs.c.id == UUID(run_id))
            .values(
                status=status,
                records_seen=records_seen,
                records_inserted=records_inserted,
                records_updated=records_updated,
                records_skipped=records_skipped,
                error_summary=error_summary,
                finished_at=func.now(),
            )
        )

        self.context.execute(query)
