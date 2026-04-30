from __future__ import annotations

import inspect
from types import SimpleNamespace

from app.checks.graph import StubJudge
from app.checks.judge import CachedJudge, JudgeDecision, OpenAIJudge
from app.schemas import Neighbor


class FakeCompletionsClient:
    def __init__(self, content: str) -> None:
        self._content = content

    def create(self, **kwargs):
        del kwargs
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content=self._content,
                    )
                )
            ]
        )


class FakeChatClient:
    def __init__(self, content: str) -> None:
        self.completions = FakeCompletionsClient(content)


class FakeOpenAIClient:
    def __init__(self, content: str) -> None:
        self.chat = FakeChatClient(content)


def test_openai_judge_parses_json_response() -> None:
    judge = OpenAIJudge(
        client=FakeOpenAIClient(
            '{"suspicious": true, "selected_match": "react", '
            '"rationale": "Close transposition of canonical package.", '
            '"confidence": "medium"}'
        ),
        model="gpt-4o-mini",
    )

    decision = judge.judge(
        ecosystem="npm",
        package="recat",
        description="React UI library",
        neighbors=[
            Neighbor(
                package="react",
                description="React library",
                similarity_score=0.74,
            )
        ],
    )

    assert decision.suspicious is True
    assert decision.selected_match == "react"
    assert decision.confidence == "medium"


def test_openai_judge_discards_unknown_selected_match() -> None:
    judge = OpenAIJudge(
        client=FakeOpenAIClient(
            '{"suspicious": true, "selected_match": "unknown-package", '
            '"rationale": "Model picked a package outside the candidate set.", '
            '"confidence": "low"}'
        ),
        model="gpt-4o-mini",
    )

    decision = judge.judge(
        ecosystem="npm",
        package="recat",
        description="React UI library",
        neighbors=[
            Neighbor(
                package="react",
                description="React library",
                similarity_score=0.74,
            )
        ],
    )

    assert decision.suspicious is True
    assert decision.selected_match is None


def test_openai_judge_normalizes_numeric_confidence() -> None:
    judge = OpenAIJudge(
        client=FakeOpenAIClient(
            '{"suspicious": true, "selected_match": "react", '
            '"rationale": "Close transposition of canonical package.", '
            '"confidence": 0.85}'
        ),
        model="gpt-4o-mini",
    )

    decision = judge.judge(
        ecosystem="npm",
        package="recat",
        description="React UI library",
        neighbors=[
            Neighbor(
                package="react",
                description="React library",
                similarity_score=0.74,
            )
        ],
    )

    assert decision.confidence == "high"


def test_all_judge_implementations_use_keyword_only_request_arguments() -> None:
    expected = inspect.signature(OpenAIJudge.judge)

    assert inspect.signature(StubJudge.judge) == expected
    assert inspect.signature(CachedJudge.judge) == expected


def test_stub_judge_accepts_keyword_only_request_arguments() -> None:
    decision = StubJudge(similarity_high_threshold=0.97).judge(
        "npm",
        package="recat",
        description="React UI library",
        neighbors=[
            Neighbor(
                package="react",
                description="React library",
                similarity_score=0.74,
            )
        ],
    )

    assert isinstance(decision, JudgeDecision)
