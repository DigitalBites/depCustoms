from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert

from .base import RepositoryContext


@dataclass
class CheckJudgeResultRepository:
    context: RepositoryContext

    def fetch_decision(
        self,
        *,
        judge_model: str,
        request_hash: str,
        candidate_hash: str,
    ) -> dict[str, object] | None:
        check_judge_results = self.context.tables.check_judge_results
        query = (
            select(
                check_judge_results.c.suspicious,
                check_judge_results.c.selected_match,
                check_judge_results.c.rationale,
                check_judge_results.c.confidence,
            )
            .where(check_judge_results.c.judge_model == judge_model)
            .where(check_judge_results.c.request_hash == request_hash)
            .where(check_judge_results.c.candidate_hash == candidate_hash)
        )

        row = self.context.fetch_one(query)
        if row is None:
            return None

        return {
            "suspicious": bool(row.suspicious),
            "selected_match": str(row.selected_match) if row.selected_match else None,
            "rationale": str(row.rationale),
            "confidence": str(row.confidence),
        }

    def record_decision(
        self,
        *,
        judge_model: str,
        request_hash: str,
        candidate_hash: str,
        ecosystem: str,
        package: str,
        description: str | None,
        suspicious: bool,
        selected_match: str | None,
        rationale: str,
        confidence: Literal["low", "medium", "high"],
    ) -> None:
        check_judge_results = self.context.tables.check_judge_results
        now = datetime.now(tz=UTC)
        statement = insert(check_judge_results).values(
            judge_model=judge_model,
            request_hash=request_hash,
            candidate_hash=candidate_hash,
            ecosystem=ecosystem,
            package=package,
            description=description,
            suspicious=suspicious,
            selected_match=selected_match,
            rationale=rationale,
            confidence=confidence,
            hit_count=1,
            created_at=now,
            last_seen_at=now,
        )
        statement = statement.on_conflict_do_update(
            index_elements=[
                check_judge_results.c.judge_model,
                check_judge_results.c.request_hash,
                check_judge_results.c.candidate_hash,
            ],
            set_={
                "hit_count": check_judge_results.c.hit_count + 1,
                "last_seen_at": func.now(),
                "description": statement.excluded.description,
                "suspicious": statement.excluded.suspicious,
                "selected_match": statement.excluded.selected_match,
                "rationale": statement.excluded.rationale,
                "confidence": statement.excluded.confidence,
            },
        )

        self.context.execute(statement)

    def bump_hit_count(
        self,
        *,
        judge_model: str,
        request_hash: str,
        candidate_hash: str,
    ) -> None:
        check_judge_results = self.context.tables.check_judge_results
        statement = (
            update(check_judge_results)
            .where(check_judge_results.c.judge_model == judge_model)
            .where(check_judge_results.c.request_hash == request_hash)
            .where(check_judge_results.c.candidate_hash == candidate_hash)
            .values(
                hit_count=check_judge_results.c.hit_count + 1,
                last_seen_at=func.now(),
            )
        )

        self.context.execute(statement)
