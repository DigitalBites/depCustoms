from __future__ import annotations

import json
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

from sources.npm.parsing import (
    PackageRecord,
    build_summary,
    dedupe_records,
    normalize_description,
    normalize_package_name,
    parse_search_object,
)
from sources.npm.registry import (
    DEFAULT_MAX_RETRIES,
    DEFAULT_QUERIES,
    DEFAULT_REQUEST_DELAY_SECONDS,
    _retry_delay_seconds,
    fetch_search_page,
)

__all__ = [
    "DEFAULT_MAX_RETRIES",
    "DEFAULT_QUERIES",
    "DEFAULT_REQUEST_DELAY_SECONDS",
    "PackageRecord",
    "_retry_delay_seconds",
    "build_summary",
    "collect_search_results",
    "dedupe_records",
    "fetch_search_page",
    "normalize_description",
    "normalize_package_name",
    "parse_search_object",
    "write_report",
]


def collect_search_results(
    queries: list[str],
    size: int,
    max_pages: int,
    timeout_seconds: float = 10.0,
    request_delay_seconds: float = DEFAULT_REQUEST_DELAY_SECONDS,
) -> tuple[list[dict[str, Any]], list[PackageRecord], list[PackageRecord]]:
    raw_objects: list[dict[str, Any]] = []
    records: list[PackageRecord] = []

    for query in queries:
        for page in range(max_pages):
            offset = page * size
            data = fetch_search_page(
                query=query,
                size=size,
                offset=offset,
                timeout_seconds=timeout_seconds,
            )
            objects = data.get("objects")
            if not isinstance(objects, list):
                raise ValueError("npm search response missing objects list")
            if not objects:
                break

            for obj in objects:
                if not isinstance(obj, dict):
                    continue
                raw_objects.append(obj)
                record = parse_search_object(obj, query=query)
                if record is not None:
                    records.append(record)
            if request_delay_seconds > 0:
                time.sleep(request_delay_seconds)

    unique_records = dedupe_records(records)
    return raw_objects, records, unique_records


def write_report(
    out_dir: Path,
    raw_objects: list[dict[str, Any]],
    records: list[PackageRecord],
    unique_records: list[PackageRecord],
) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)

    raw_path = out_dir / "npm-search-raw.json"
    parsed_path = out_dir / "npm-search-normalized.json"
    summary_path = out_dir / "npm-search-summary.json"

    summary = build_summary(raw_objects, records, unique_records)

    raw_path.write_text(json.dumps(raw_objects, indent=2), encoding="utf-8")
    parsed_path.write_text(
        json.dumps([asdict(record) for record in unique_records], indent=2),
        encoding="utf-8",
    )
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    return summary
