from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Pull npm registry search samples and summarize corpus quality."
    )
    parser.add_argument(
        "--query",
        action="append",
        dest="queries",
        help="Search query to run. May be repeated. Defaults to a small broad set.",
    )
    parser.add_argument(
        "--size",
        type=int,
        default=250,
        help="Page size for npm search requests. Default: 250.",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=4,
        help="Number of pages to fetch per query. Default: 4.",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=10.0,
        help="HTTP timeout per request. Default: 10s.",
    )
    parser.add_argument(
        "--out-dir",
        default="data/npm-sample",
        help="Output directory for raw, normalized, and summary JSON files.",
    )
    return parser.parse_args()


def main() -> int:
    from spike.npm_corpus import (
        DEFAULT_QUERIES,
        collect_search_results,
        write_report,
    )

    args = parse_args()
    queries = args.queries or DEFAULT_QUERIES

    raw_objects, records, unique_records = collect_search_results(
        queries=queries,
        size=args.size,
        max_pages=args.max_pages,
        timeout_seconds=args.timeout_seconds,
    )
    summary = write_report(
        out_dir=Path(args.out_dir),
        raw_objects=raw_objects,
        records=records,
        unique_records=unique_records,
    )

    print("npm corpus spike complete")
    print(f"queries: {', '.join(queries)}")
    print(f"raw_result_count: {summary['raw_result_count']}")
    print(f"parsed_record_count: {summary['parsed_record_count']}")
    print(f"unique_record_count: {summary['unique_record_count']}")
    print(
        "description_coverage_ratio: "
        f"{summary['description_coverage_ratio']:.2%}"
    )
    print(f"output_dir: {Path(args.out_dir).resolve()}")

    top_examples = summary["top_examples"][:5]
    if top_examples:
        print("top_examples:")
        for example in top_examples:
            print(
                f"  - {example['package']} "
                "(score="
                f"{example['score_final']}, "
                f"desc={'yes' if example['description'] else 'no'})"
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
