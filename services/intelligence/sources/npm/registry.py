from __future__ import annotations

import json
import logging
import time
from typing import Any
from urllib import error, parse, request

NPM_SEARCH_URL = "https://registry.npmjs.org/-/v1/search"
DEFAULT_REQUEST_DELAY_SECONDS = 0.5
DEFAULT_MAX_RETRIES = 4
DEFAULT_QUERIES = [
    "keywords:javascript",
    "keywords:typescript",
    "keywords:node",
    "keywords:testing",
    "keywords:build",
    "keywords:lint",
    "keywords:utility",
    "react",
    "express",
    "webpack",
    "eslint",
    "jest",
    "lodash",
    "axios",
    "commander",
]

logger: logging.Logger = logging.getLogger("customs.intelligence.npm")


def fetch_search_page(
    query: str,
    size: int,
    offset: int,
    timeout_seconds: float = 10.0,
    max_retries: int = DEFAULT_MAX_RETRIES,
) -> dict[str, Any]:
    params = parse.urlencode({"text": query, "size": size, "from": offset})
    url = f"{NPM_SEARCH_URL}?{params}"
    logger.info(
        "fetching npm search page",
        extra={
            "query": query,
            "offset": offset,
            "size": size,
            "timeout_seconds": timeout_seconds,
        },
    )
    req = request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "customs-intelligence-spike/0.1",
        },
    )
    payload = _fetch_with_retry(
        req=req,
        timeout_seconds=timeout_seconds,
        max_retries=max_retries,
    )
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise ValueError("Unexpected npm search response shape")
    return data


def _fetch_with_retry(
    req: request.Request,
    timeout_seconds: float,
    max_retries: int,
) -> str:
    attempt = 0
    while True:
        try:
            with request.urlopen(req, timeout=timeout_seconds) as response:
                return response.read().decode("utf-8")
        except error.HTTPError as exc:
            if exc.code != 429 or attempt >= max_retries:
                raise
            retry_after = exc.headers.get("Retry-After")
            delay_seconds = _retry_delay_seconds(
                retry_after=retry_after,
                attempt=attempt,
            )
            logger.info(
                "npm search rate limited; backing off",
                extra={
                    "status_code": exc.code,
                    "attempt": attempt + 1,
                    "max_retries": max_retries,
                    "delay_seconds": delay_seconds,
                },
            )
            time.sleep(delay_seconds)
            attempt += 1


def _retry_delay_seconds(
    retry_after: str | None,
    attempt: int,
) -> float:
    if retry_after is not None:
        try:
            parsed = float(retry_after)
            if parsed > 0:
                return parsed
        except ValueError:
            pass
    return min(2**attempt, 8.0)
