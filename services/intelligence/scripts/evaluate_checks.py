# ruff: noqa: E402
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib import request

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEFAULT_BASE_URL = "http://localhost:8001"
DEFAULT_CASES_PATH = Path("evaluation/npm_sanity_cases.json")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run /check evaluation cases.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--cases-path", default=str(DEFAULT_CASES_PATH))
    parser.add_argument("--output-json", default="")
    return parser


def load_cases(path: Path) -> list[dict[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("evaluation cases must be a JSON array")
    return [dict(item) for item in payload]


def run_case(base_url: str, case: dict[str, str]) -> dict[str, object]:
    body = json.dumps(
        {
            "ecosystem": case["ecosystem"],
            "package": case["package"],
            "description": case.get("description"),
        }
    ).encode("utf-8")
    req = request.Request(
        f"{base_url}/check",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(req, timeout=30.0) as response:
        result = json.loads(response.read().decode("utf-8"))
    metadata = result.get("metadata") or {}
    stage_timings = metadata.get("stage_timings_ms") or {}
    return {
        "label": case["label"],
        "package": case["package"],
        "expected": case.get("expected"),
        "nearest_match": result.get("nearest_match"),
        "match_quality": result.get("match_quality"),
        "recommended_action": result.get("recommended_action"),
        "semantic_score": metadata.get("similarity_score"),
        "lexical_score": metadata.get("lexical_similarity_score"),
        "candidate_source_rank": metadata.get("candidate_source_rank"),
        "candidate_score_final": metadata.get("candidate_score_final"),
        "candidate_trust": metadata.get("candidate_trust"),
        "adjacent_name_found_in_corpus": metadata.get(
            "adjacent_name_found_in_corpus"
        ),
        "exact_match_lookup_ms": stage_timings.get("exact_match_lookup"),
        "embed_query_ms": stage_timings.get("embed_query"),
        "candidate_search_ms": stage_timings.get("candidate_search"),
        "judge_ms": stage_timings.get("judge"),
        "judge_cache_hit": metadata.get("judge_cache_hit"),
        "is_suspicious": result.get("is_suspicious"),
        "confidence": result.get("confidence"),
        "source": result.get("source"),
        "latency_ms": result.get("latency_ms"),
    }


def print_table(rows: list[dict[str, object]]) -> None:
    headers = [
        "label",
        "expected",
        "package",
        "nearest_match",
        "match_quality",
        "recommended_action",
        "semantic_score",
        "lexical_score",
        "candidate_source_rank",
        "candidate_score_final",
        "candidate_trust",
        "adjacent_name_found_in_corpus",
        "exact_match_lookup_ms",
        "embed_query_ms",
        "candidate_search_ms",
        "judge_ms",
        "judge_cache_hit",
        "is_suspicious",
        "confidence",
        "source",
        "latency_ms",
    ]
    print("| " + " | ".join(headers) + " |")
    print("|" + "|".join("---" for _ in headers) + "|")
    for row in rows:
        values = []
        for header in headers:
            value = row.get(header)
            if isinstance(value, float):
                values.append(f"{value:.6f}")
            else:
                values.append(str(value))
        print("| " + " | ".join(values) + " |")


def main() -> int:
    args = build_parser().parse_args()
    cases = load_cases(Path(args.cases_path))
    rows = [run_case(args.base_url, case) for case in cases]
    print_table(rows)
    if args.output_json:
        Path(args.output_json).write_text(
            json.dumps(rows, indent=2),
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
