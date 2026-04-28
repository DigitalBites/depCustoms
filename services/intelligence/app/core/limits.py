from __future__ import annotations

from collections import deque
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from threading import BoundedSemaphore, Lock
from time import monotonic

from .errors import IntelligenceServiceError


@dataclass
class SlidingWindowRateLimiter:
    max_requests: int
    window_seconds: float = 60.0
    _lock: Lock = field(default_factory=Lock, init=False, repr=False)
    _request_times: dict[str, deque[float]] = field(
        default_factory=dict, init=False, repr=False
    )

    def allow(self, key: str) -> bool:
        now = monotonic()
        with self._lock:
            window = self._request_times.setdefault(key, deque())
            cutoff = now - self.window_seconds
            while window and window[0] <= cutoff:
                window.popleft()
            if len(window) >= self.max_requests:
                return False
            window.append(now)
            return True


@dataclass
class CheckRequestLimiter:
    max_requests_per_minute: int
    max_concurrent_requests: int
    _rate_limiter: SlidingWindowRateLimiter = field(init=False, repr=False)
    _concurrency_limiter: BoundedSemaphore = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._rate_limiter = SlidingWindowRateLimiter(self.max_requests_per_minute)
        self._concurrency_limiter = BoundedSemaphore(self.max_concurrent_requests)

    def check_rate_limit(self, key: str) -> None:
        if self._rate_limiter.allow(key):
            return
        raise IntelligenceServiceError(
            status_code=429,
            code="rate_limited",
            message="Intelligence check rate limit exceeded.",
            detail=None,
        )

    @contextmanager
    def acquire(self) -> Iterator[None]:
        acquired = self._concurrency_limiter.acquire(blocking=False)
        if not acquired:
            raise IntelligenceServiceError(
                status_code=503,
                code="service_busy",
                message="Intelligence service is temporarily busy.",
                detail=None,
            )
        try:
            yield
        finally:
            self._concurrency_limiter.release()
