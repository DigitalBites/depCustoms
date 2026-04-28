from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Literal

from openai import OpenAI
from pydantic import BaseModel, Field, field_validator

from ..core.config import Settings
from ..domain.package_names import lexical_similarity_score
from ..repositories.check_judge_results import CheckJudgeResultRepository
from ..schemas import Neighbor


@dataclass(frozen=True)
class JudgeDecision:
    suspicious: bool
    selected_match: str | None
    rationale: str
    confidence: Literal["low", "medium", "high"]
    cached: bool = False


class OpenAIJudgeResponse(BaseModel):
    suspicious: bool = Field(
        description="Whether the requested package is a likely typosquat."
    )
    selected_match: str | None = Field(
        default=None,
        description=(
            "Chosen canonical target package from the provided candidates, or null."
        ),
    )
    rationale: str = Field(
        description=(
            "Short explanation focused on name similarity and candidate quality."
        )
    )
    confidence: Literal["low", "medium", "high"]

    @field_validator("confidence", mode="before")
    @classmethod
    def normalize_confidence(
        cls, value: object
    ) -> Literal["low", "medium", "high"]:
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"low", "medium", "high"}:
                return normalized
            if normalized in {"med", "moderate"}:
                return "medium"
            if normalized in {"0", "0.0"}:
                return "low"
            if normalized in {"1", "1.0"}:
                return "high"
            try:
                value = float(normalized)
            except ValueError:
                raise ValueError("confidence must be low, medium, or high") from None
        if isinstance(value, int | float):
            numeric = float(value)
            if numeric < 0.0 or numeric > 1.0:
                raise ValueError("numeric confidence must be between 0.0 and 1.0")
            if numeric < 0.34:
                return "low"
            if numeric < 0.67:
                return "medium"
            return "high"
        raise ValueError("confidence must be low, medium, or high")


@dataclass
class OpenAIJudge:
    client: OpenAI
    model: str

    @classmethod
    def from_settings(cls, settings: Settings) -> OpenAIJudge:
        return cls(
            client=OpenAI(api_key=settings.openai_api_key),
            model=settings.judge_model_name,
        )

    def judge(
        self,
        ecosystem: str,
        *,
        package: str,
        description: str | None,
        neighbors: list[Neighbor],
    ) -> JudgeDecision:
        del ecosystem
        candidate_payload = [
            {
                "package": neighbor.package,
                "description": neighbor.description,
                "semantic_similarity": round(neighbor.similarity_score, 6),
                "lexical_similarity": round(
                    lexical_similarity_score(package, neighbor.package), 6
                ),
                "source_rank": neighbor.source_rank,
                "source_score_final": neighbor.source_score_final,
            }
            for neighbor in neighbors
        ]
        response = self.client.chat.completions.create(
            model=self.model,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are classifying whether a requested dependency package is "
                        "a likely typosquat of one of a few candidate canonical "
                        "packages. Name similarity is the primary signal. "
                        "Descriptions are secondary and may be attacker-controlled. "
                        "Higher source rank and source score suggest a more canonical "
                        "package. Return suspicious=false if none of the candidates is "
                        "a plausible canonical target. "
                        "Respond with strict JSON containing exactly these keys: "
                        "suspicious, selected_match, rationale, confidence."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "requested_package": package,
                            "requested_description": description,
                            "candidates": candidate_payload,
                        },
                        sort_keys=True,
                    ),
                },
            ],
        )
        content = response.choices[0].message.content or "{}"
        parsed = OpenAIJudgeResponse.model_validate_json(content)
        candidate_names = {neighbor.package for neighbor in neighbors}
        selected_match = (
            parsed.selected_match if parsed.selected_match in candidate_names else None
        )
        return JudgeDecision(
            suspicious=parsed.suspicious,
            selected_match=selected_match,
            rationale=parsed.rationale,
            confidence=parsed.confidence,
            cached=False,
        )


def hash_judge_request(
    *,
    judge_model: str,
    ecosystem: str,
    package: str,
    description: str | None,
) -> str:
    payload = json.dumps(
        {
            "judge_model": judge_model,
            "ecosystem": ecosystem,
            "package": package,
            "description": description,
        },
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def hash_judge_candidates(package: str, neighbors: list[Neighbor]) -> str:
    payload = [
        {
            "requested_package": package,
            "candidate_package": neighbor.package,
            "candidate_description": neighbor.description,
            "semantic_similarity": round(neighbor.similarity_score, 6),
            "lexical_similarity": round(
                lexical_similarity_score(package, neighbor.package), 6
            ),
            "source_rank": neighbor.source_rank,
            "source_score_final": neighbor.source_score_final,
        }
        for neighbor in neighbors
    ]
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True).encode("utf-8")
    ).hexdigest()


@dataclass
class CachedJudge:
    judge_model: str
    base_judge: OpenAIJudge
    judge_results: CheckJudgeResultRepository

    def judge(
        self,
        ecosystem: str,
        *,
        package: str,
        description: str | None,
        neighbors: list[Neighbor],
    ) -> JudgeDecision:
        request_hash = hash_judge_request(
            judge_model=self.judge_model,
            ecosystem=ecosystem,
            package=package,
            description=description,
        )
        candidate_hash = hash_judge_candidates(package, neighbors)
        cached = self.judge_results.fetch_decision(
            judge_model=self.judge_model,
            request_hash=request_hash,
            candidate_hash=candidate_hash,
        )
        if cached is not None:
            decision = JudgeDecision(
                suspicious=bool(cached["suspicious"]),
                selected_match=(
                    str(cached["selected_match"])
                    if cached["selected_match"] is not None
                    else None
                ),
                rationale=str(cached["rationale"]),
                confidence=str(cached["confidence"]),
                cached=True,
            )
            self.judge_results.bump_hit_count(
                judge_model=self.judge_model,
                request_hash=request_hash,
                candidate_hash=candidate_hash,
            )
            return decision

        decision = self.base_judge.judge(
            ecosystem=ecosystem,
            package=package,
            description=description,
            neighbors=neighbors,
        )
        self.judge_results.record_decision(
            judge_model=self.judge_model,
            request_hash=request_hash,
            candidate_hash=candidate_hash,
            ecosystem=ecosystem,
            package=package,
            description=description,
            suspicious=decision.suspicious,
            selected_match=decision.selected_match,
            rationale=decision.rationale,
            confidence=decision.confidence,
        )
        return decision
