from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class PackageRecord:
    ecosystem: str
    package: str
    description: str | None
    version: str | None
    score_final: float | None
    score_detail_quality: float | None
    score_detail_popularity: float | None
    score_detail_maintenance: float | None
    search_query: str


def normalize_package_name(name: str) -> str:
    value = name.strip().lower()
    value = re.sub(r"\s+", "", value)
    return value


def normalize_description(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = re.sub(r"\s+", " ", value).strip()
    return normalized or None


def parse_search_object(obj: dict[str, Any], query: str) -> PackageRecord | None:
    package = obj.get("package")
    score = obj.get("score") or {}
    detail = score.get("detail") or {}

    if not isinstance(package, dict):
        return None

    name = package.get("name")
    if not isinstance(name, str) or not normalize_package_name(name):
        return None

    version = package.get("version")
    if not isinstance(version, str):
        version = None

    final_score = score.get("final")
    if not isinstance(final_score, int | float):
        final_score = None

    def score_value(key: str) -> float | None:
        value = detail.get(key)
        if isinstance(value, int | float):
            return float(value)
        return None

    return PackageRecord(
        ecosystem="npm",
        package=normalize_package_name(name),
        description=normalize_description(package.get("description")),
        version=version,
        score_final=float(final_score) if final_score is not None else None,
        score_detail_quality=score_value("quality"),
        score_detail_popularity=score_value("popularity"),
        score_detail_maintenance=score_value("maintenance"),
        search_query=query,
    )


def dedupe_records(records: list[PackageRecord]) -> list[PackageRecord]:
    by_name: dict[str, PackageRecord] = {}
    for record in records:
        existing = by_name.get(record.package)
        if existing is None:
            by_name[record.package] = record
            continue

        existing_score = (
            existing.score_final if existing.score_final is not None else -1.0
        )
        record_score = record.score_final if record.score_final is not None else -1.0
        if record_score > existing_score:
            by_name[record.package] = record
            continue
        if math.isclose(record_score, existing_score) and existing.description is None:
            by_name[record.package] = record
    return sorted(by_name.values(), key=lambda record: record.package)


def build_summary(
    raw_objects: list[dict[str, Any]],
    records: list[PackageRecord],
    unique_records: list[PackageRecord],
) -> dict[str, Any]:
    descriptions_present = sum(1 for record in unique_records if record.description)
    query_breakdown: dict[str, int] = {}
    for record in records:
        query_breakdown[record.search_query] = (
            query_breakdown.get(record.search_query, 0) + 1
        )

    top_examples = sorted(
        unique_records,
        key=lambda record: (
            record.score_final if record.score_final is not None else -1.0
        ),
        reverse=True,
    )[:20]

    return {
        "ecosystem": "npm",
        "raw_result_count": len(raw_objects),
        "parsed_record_count": len(records),
        "unique_record_count": len(unique_records),
        "description_coverage_count": descriptions_present,
        "description_coverage_ratio": round(
            descriptions_present / len(unique_records), 4
        )
        if unique_records
        else 0.0,
        "query_breakdown": query_breakdown,
        "top_examples": [asdict(record) for record in top_examples],
    }
