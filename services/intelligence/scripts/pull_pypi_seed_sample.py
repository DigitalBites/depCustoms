from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Pull a PyPI seed sample and summarize metadata quality."
    )
    parser.add_argument(
        "--package",
        action="append",
        dest="packages",
        help="Seed package name to inspect. May be repeated.",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=20.0,
        help="HTTP timeout per request. Default: 20s.",
    )
    parser.add_argument(
        "--out-dir",
        default="data/pypi-sample",
        help="Output directory for normalized and summary JSON files.",
    )
    return parser.parse_args()


def main() -> int:
    from spike.pypi_corpus import (
        DEFAULT_SEED_PACKAGES,
        collect_seed_package_records,
        fetch_simple_index_count,
        write_report,
    )

    args = parse_args()
    packages = args.packages or DEFAULT_SEED_PACKAGES

    simple_count = fetch_simple_index_count(
        timeout_seconds=max(args.timeout_seconds, 30.0)
    )
    records = collect_seed_package_records(
        package_names=packages, timeout_seconds=args.timeout_seconds
    )
    summary = write_report(
        out_dir=Path(args.out_dir),
        records=records,
        simple_index_project_count=simple_count,
    )

    print("pypi corpus spike complete")
    print(f"packages: {', '.join(packages)}")
    print(f"simple_index_project_count: {summary['simple_index_project_count']}")
    print(f"seed_package_count: {summary['seed_package_count']}")
    print(f"summary_coverage_ratio: {summary['summary_coverage_ratio']:.2%}")
    print(
        "description_coverage_ratio: "
        f"{summary['description_coverage_ratio']:.2%}"
    )
    print(f"downloads_coverage_ratio: {summary['downloads_coverage_ratio']:.2%}")
    print(f"output_dir: {Path(args.out_dir).resolve()}")

    top_examples = summary["top_examples"][:5]
    if top_examples:
        print("top_examples:")
        for example in top_examples:
            print(
                f"  - {example['package']} "
                "(month="
                f"{example['downloads_last_month']}, "
                f"summary={'yes' if example['summary'] else 'no'})"
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
