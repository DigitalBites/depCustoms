from __future__ import annotations

from sources.npm.registry import _retry_delay_seconds


def test_retry_delay_seconds_prefers_retry_after_header() -> None:
    assert _retry_delay_seconds(retry_after="3", attempt=0) == 3.0


def test_retry_delay_seconds_uses_backoff_when_header_invalid() -> None:
    assert _retry_delay_seconds(retry_after="bad", attempt=0) == 1.0
    assert _retry_delay_seconds(retry_after=None, attempt=3) == 8.0
