from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib import error, request

PYPI_SIMPLE_URL = "https://pypi.org/simple/"
PYPI_PACKAGE_JSON_URL = "https://pypi.org/pypi/{name}/json"
PYPISTATS_RECENT_URL = "https://pypistats.org/api/packages/{name}/recent"

DEFAULT_SEED_PACKAGES = [
    "requests",
    "numpy",
    "pandas",
    "django",
    "flask",
    "pytest",
    "urllib3",
    "pip",
    "setuptools",
    "pydantic",
]


@dataclass(frozen=True)
class PypiPackageRecord:
    ecosystem: str
    package: str
    summary: str | None
    description: str | None
    version: str | None
    downloads_last_day: int | None
    downloads_last_week: int | None
    downloads_last_month: int | None


def normalize_package_name(name: str) -> str:
    value = name.strip().lower()
    value = re.sub(r"[-_.]+", "-", value)
    return value


def normalize_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = re.sub(r"\s+", " ", value).strip()
    return normalized or None


def fetch_simple_index_count(timeout_seconds: float = 30.0) -> int:
    req = request.Request(
        PYPI_SIMPLE_URL,
        headers={
            "Accept": "application/vnd.pypi.simple.v1+json",
            "User-Agent": "customs-intelligence-spike/0.1",
        },
    )
    with request.urlopen(req, timeout=timeout_seconds) as response:
        data = json.load(response)
    projects = data.get("projects")
    if not isinstance(projects, list):
        raise ValueError("PyPI simple API response missing projects list")
    return len(projects)


def fetch_package_json(name: str, timeout_seconds: float = 20.0) -> dict[str, Any]:
    req = request.Request(
        PYPI_PACKAGE_JSON_URL.format(name=name),
        headers={"User-Agent": "customs-intelligence-spike/0.1"},
    )
    with request.urlopen(req, timeout=timeout_seconds) as response:
        data = json.load(response)
    if not isinstance(data, dict):
        raise ValueError("Unexpected PyPI package JSON response shape")
    return data


def fetch_recent_downloads(
    name: str, timeout_seconds: float = 20.0
) -> dict[str, int] | None:
    req = request.Request(
        PYPISTATS_RECENT_URL.format(name=name),
        headers={"User-Agent": "customs-intelligence-spike/0.1"},
    )
    try:
        with request.urlopen(req, timeout=timeout_seconds) as response:
            data = json.load(response)
    except error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise

    payload = data.get("data")
    if not isinstance(payload, dict):
        return None

    result: dict[str, int] = {}
    for key in ("last_day", "last_week", "last_month"):
        value = payload.get(key)
        if isinstance(value, int):
            result[key] = value
    return result


def build_record(
    name: str,
    package_json: dict[str, Any],
    recent_downloads: dict[str, int] | None,
) -> PypiPackageRecord:
    info = package_json.get("info") or {}

    version = info.get("version")
    if not isinstance(version, str):
        version = None

    return PypiPackageRecord(
        ecosystem="pypi",
        package=normalize_package_name(name),
        summary=normalize_text(info.get("summary")),
        description=normalize_text(info.get("description")),
        version=version,
        downloads_last_day=(recent_downloads or {}).get("last_day"),
        downloads_last_week=(recent_downloads or {}).get("last_week"),
        downloads_last_month=(recent_downloads or {}).get("last_month"),
    )


def collect_seed_package_records(
    package_names: list[str], timeout_seconds: float = 20.0
) -> list[PypiPackageRecord]:
    records: list[PypiPackageRecord] = []
    for name in package_names:
        package_json = fetch_package_json(name, timeout_seconds=timeout_seconds)
        recent_downloads = fetch_recent_downloads(name, timeout_seconds=timeout_seconds)
        records.append(build_record(name, package_json, recent_downloads))
    return records


def build_summary(
    records: list[PypiPackageRecord], simple_index_project_count: int
) -> dict[str, Any]:
    summary_count = sum(1 for record in records if record.summary)
    description_count = sum(1 for record in records if record.description)
    downloads_count = sum(
        1 for record in records if record.downloads_last_month is not None
    )

    top_examples = sorted(
        records,
        key=lambda record: record.downloads_last_month
        if record.downloads_last_month is not None
        else -1,
        reverse=True,
    )[:20]

    return {
        "ecosystem": "pypi",
        "simple_index_project_count": simple_index_project_count,
        "seed_package_count": len(records),
        "summary_coverage_count": summary_count,
        "summary_coverage_ratio": round(summary_count / len(records), 4)
        if records
        else 0.0,
        "description_coverage_count": description_count,
        "description_coverage_ratio": round(description_count / len(records), 4)
        if records
        else 0.0,
        "downloads_coverage_count": downloads_count,
        "downloads_coverage_ratio": round(downloads_count / len(records), 4)
        if records
        else 0.0,
        "top_examples": [asdict(record) for record in top_examples],
    }


def write_report(
    out_dir: Path,
    records: list[PypiPackageRecord],
    simple_index_project_count: int,
) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)

    parsed_path = out_dir / "pypi-seed-normalized.json"
    summary_path = out_dir / "pypi-seed-summary.json"

    summary = build_summary(records, simple_index_project_count)

    parsed_path.write_text(
        json.dumps([asdict(record) for record in records], indent=2),
        encoding="utf-8",
    )
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    return summary
