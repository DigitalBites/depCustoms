from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def build_parser() -> argparse.ArgumentParser:
    from sources.npm.collect import (
        DEFAULT_COLLECT_MAX_PAGES,
        DEFAULT_COLLECT_MAX_RETRIES,
        DEFAULT_COLLECT_REQUEST_DELAY_SECONDS,
        DEFAULT_COLLECT_SIZE,
        DEFAULT_COLLECT_TIMEOUT_SECONDS,
    )

    parser = argparse.ArgumentParser(description="Manage intelligence seed pipelines.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    collect = subparsers.add_parser("collect", help="Collect raw seed data.")
    collect.add_argument("ecosystem", choices=["npm"])
    collect.add_argument(
        "--query",
        action="append",
        dest="queries",
        help="Search query to run. May be repeated.",
    )
    collect.add_argument("--size", type=int, default=DEFAULT_COLLECT_SIZE)
    collect.add_argument("--max-pages", type=int, default=DEFAULT_COLLECT_MAX_PAGES)
    collect.add_argument(
        "--timeout-seconds",
        type=float,
        default=DEFAULT_COLLECT_TIMEOUT_SECONDS,
    )
    collect.add_argument(
        "--request-delay-seconds",
        type=float,
        default=DEFAULT_COLLECT_REQUEST_DELAY_SECONDS,
    )
    collect.add_argument(
        "--max-retries",
        type=int,
        default=DEFAULT_COLLECT_MAX_RETRIES,
    )
    collect.add_argument("--output-dir", default="data")

    normalize = subparsers.add_parser(
        "normalize",
        help="Normalize collected seed data.",
    )
    normalize.add_argument("ecosystem", choices=["npm"])
    normalize.add_argument(
        "--input-path",
        default="data/npm/raw/npm-search-pages.ndjson.gz",
    )
    normalize.add_argument("--output-dir", default="data")

    load = subparsers.add_parser(
        "load",
        help="Load normalized seed data into Postgres.",
    )
    load.add_argument("ecosystem", choices=["npm"])
    load.add_argument(
        "--input-path",
        default="data/npm/normalized/npm-seed-records.ndjson.gz",
    )

    refresh = subparsers.add_parser(
        "refresh",
        help="Run collect, normalize, and load in sequence.",
    )
    refresh.add_argument("ecosystem", choices=["npm"])
    refresh.add_argument(
        "--query",
        action="append",
        dest="queries",
        help="Search query to run. May be repeated.",
    )
    refresh.add_argument("--size", type=int, default=DEFAULT_COLLECT_SIZE)
    refresh.add_argument("--max-pages", type=int, default=DEFAULT_COLLECT_MAX_PAGES)
    refresh.add_argument(
        "--timeout-seconds",
        type=float,
        default=DEFAULT_COLLECT_TIMEOUT_SECONDS,
    )
    refresh.add_argument(
        "--request-delay-seconds",
        type=float,
        default=DEFAULT_COLLECT_REQUEST_DELAY_SECONDS,
    )
    refresh.add_argument(
        "--max-retries",
        type=int,
        default=DEFAULT_COLLECT_MAX_RETRIES,
    )
    refresh.add_argument("--output-dir", default="data")

    return parser


def main() -> int:
    from app.core.config import get_settings
    from app.services.artifact_store import ArtifactStore
    from app.services.npm_seed_pipeline import NpmSeedPipelineService

    parser = build_parser()
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(name)s %(message)s",
    )
    settings = get_settings()
    pipeline = NpmSeedPipelineService(
        settings=settings,
        artifact_store=ArtifactStore(),
    )

    if args.command == "collect":
        result = pipeline.collect(
            output_dir=Path(args.output_dir),
            queries=args.queries,
            size=args.size,
            max_pages=args.max_pages,
            timeout_seconds=args.timeout_seconds,
            request_delay_seconds=args.request_delay_seconds,
            max_retries=args.max_retries,
        )
        print(f"collected raw npm pages: {result.record_count}")
        print(f"artifact: {result.artifact_path}")
        print(f"manifest: {result.manifest_path}")
        return 0

    if args.command == "normalize":
        result = pipeline.normalize(
            input_path=Path(args.input_path),
            output_dir=Path(args.output_dir),
        )
        print(f"normalized npm seed records: {result.record_count}")
        print(f"artifact: {result.artifact_path}")
        print(f"manifest: {result.manifest_path}")
        return 0

    if args.command == "load":
        result = pipeline.load(input_path=Path(args.input_path))
        print(f"loaded npm seed records: {result.records_seen}")
        print(f"inserted: {result.records_inserted}")
        print(f"updated: {result.records_updated}")
        print(f"skipped: {result.records_skipped}")
        print(f"run_id: {result.run_id}")
        return 0

    if args.command == "refresh":
        collect_result, normalize_result, load_result = pipeline.refresh(
            output_dir=Path(args.output_dir),
            queries=args.queries,
            size=args.size,
            max_pages=args.max_pages,
            timeout_seconds=args.timeout_seconds,
            request_delay_seconds=args.request_delay_seconds,
            max_retries=args.max_retries,
        )
        print(f"collected raw npm pages: {collect_result.record_count}")
        print(f"normalized npm seed records: {normalize_result.record_count}")
        print(f"loaded npm seed records: {load_result.records_seen}")
        print(f"run_id: {load_result.run_id}")
        return 0

    parser.error(f"unsupported command: {args.command}")
    return 1

if __name__ == "__main__":
    raise SystemExit(main())
