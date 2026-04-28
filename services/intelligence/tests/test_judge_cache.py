from __future__ import annotations

from dataclasses import dataclass

from app.checks.judge import CachedJudge, JudgeDecision
from app.schemas import Neighbor


@dataclass
class FakeJudge:
    calls: int = 0

    def judge(
        self,
        ecosystem: str,
        *,
        package: str,
        description: str | None,
        neighbors: list[Neighbor],
    ) -> JudgeDecision:
        del ecosystem, package, description, neighbors
        self.calls += 1
        return JudgeDecision(
            suspicious=True,
            selected_match="react",
            rationale="Cached judge test decision.",
            confidence="high",
        )


class FakeJudgeResultsRepository:
    def __init__(self) -> None:
        self.records: dict[tuple[str, str, str], dict[str, object]] = {}
        self.record_calls = 0
        self.bump_calls = 0

    def fetch_decision(
        self,
        *,
        judge_model: str,
        request_hash: str,
        candidate_hash: str,
    ) -> dict[str, object] | None:
        return self.records.get((judge_model, request_hash, candidate_hash))

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
        confidence: str,
    ) -> None:
        del ecosystem, package, description
        self.record_calls += 1
        self.records[(judge_model, request_hash, candidate_hash)] = {
            "suspicious": suspicious,
            "selected_match": selected_match,
            "rationale": rationale,
            "confidence": confidence,
        }

    def bump_hit_count(
        self,
        *,
        judge_model: str,
        request_hash: str,
        candidate_hash: str,
    ) -> None:
        del judge_model, request_hash, candidate_hash
        self.bump_calls += 1


def test_cached_judge_reuses_cached_decision() -> None:
    base_judge = FakeJudge()
    judge_results = FakeJudgeResultsRepository()
    judge = CachedJudge(
        judge_model="openai/gpt-4o-mini",
        base_judge=base_judge,
        judge_results=judge_results,
    )
    neighbors = [
        Neighbor(
            package="react",
            description="React library",
            similarity_score=0.75,
            source_rank=1,
            source_score_final=2314.9753,
        )
    ]

    first = judge.judge(
        ecosystem="npm",
        package="recat",
        description="React UI library",
        neighbors=neighbors,
    )
    second = judge.judge(
        ecosystem="npm",
        package="recat",
        description="React UI library",
        neighbors=neighbors,
    )

    assert first.suspicious == second.suspicious
    assert first.selected_match == second.selected_match
    assert first.rationale == second.rationale
    assert first.confidence == second.confidence
    assert first.cached is False
    assert second.cached is True
    assert base_judge.calls == 1
    assert judge_results.record_calls == 1
    assert judge_results.bump_calls == 1
