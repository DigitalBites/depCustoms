from __future__ import annotations

import argparse
import logging
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEFAULT_PRESET_QUERIES = (
    "keywords:javascript",
    "keywords:typescript",
    "react",
    "express",
    "lodash",
    "axios",
)


@dataclass(frozen=True)
class SeedPreset:
    name: str
    description: str
    size: int
    max_pages: int
    queries: tuple[str, ...]


SAMPLE_PRESET = SeedPreset(
    name="sample",
    description=(
        "Small smoke-test corpus for local plumbing checks. Fast, but too small "
        "for meaningful evaluation quality."
    ),
    size=50,
    max_pages=2,
    queries=DEFAULT_PRESET_QUERIES,
)

BOOTSTRAP_PRESET = SeedPreset(
    name="bootstrap",
    description=(
        "Larger first-run corpus for a fresh environment. Slower, but intended "
        "to build a usable starting corpus for evaluation."
    ),
    size=100,
    max_pages=20,
    queries=tuple([*DEFAULT_PRESET_QUERIES, "commander"]),
)

SEED_PRESETS: dict[str, SeedPreset] = {
    SAMPLE_PRESET.name: SAMPLE_PRESET,
    BOOTSTRAP_PRESET.name: BOOTSTRAP_PRESET,
}

LOW_CORPUS_WARNING_THRESHOLD = 5_000


def build_parser() -> argparse.ArgumentParser:
    from sources.npm.collect import (
        DEFAULT_COLLECT_MAX_RETRIES,
        DEFAULT_COLLECT_REQUEST_DELAY_SECONDS,
        DEFAULT_COLLECT_TIMEOUT_SECONDS,
    )

    parser = argparse.ArgumentParser(description="Manage intelligence seed pipelines.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    collect = subparsers.add_parser("collect", help="Collect raw seed data.")
    collect.add_argument("ecosystem", choices=["npm"])
    collect.add_argument(
        "--preset",
        required=True,
        choices=sorted(SEED_PRESETS),
        help=build_preset_help(),
    )
    collect.add_argument(
        "--query",
        action="append",
        dest="queries",
        help="Search query set override. May be repeated.",
    )
    collect.add_argument(
        "--size",
        type=int,
        default=None,
        help="Override the selected preset page size.",
    )
    collect.add_argument(
        "--max-pages",
        type=int,
        default=None,
        help="Override the selected preset page count.",
    )
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
        "--preset",
        required=True,
        choices=sorted(SEED_PRESETS),
        help=build_preset_help(),
    )
    refresh.add_argument(
        "--query",
        action="append",
        dest="queries",
        help="Search query set override. May be repeated.",
    )
    refresh.add_argument(
        "--size",
        type=int,
        default=None,
        help="Override the selected preset page size.",
    )
    refresh.add_argument(
        "--max-pages",
        type=int,
        default=None,
        help="Override the selected preset page count.",
    )
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


def build_preset_help() -> str:
    return "; ".join(
        f"{preset.name}: {preset.description}"
        for preset in (
            SAMPLE_PRESET,
            BOOTSTRAP_PRESET,
        )
    )


def resolve_collect_dimensions(
    *,
    preset_name: str,
    size_override: int | None,
    max_pages_override: int | None,
) -> tuple[SeedPreset, int, int]:
    preset = SEED_PRESETS[preset_name]
    size = size_override if size_override is not None else preset.size
    max_pages = (
        max_pages_override if max_pages_override is not None else preset.max_pages
    )
    return preset, size, max_pages


def resolve_collect_queries(
    *,
    preset: SeedPreset,
    override_queries: list[str] | None,
) -> list[str]:
    queries: list[str] = []
    seen: set[str] = set()
    effective_queries = override_queries if override_queries else list(preset.queries)
    for query in effective_queries:
        normalized = query.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        queries.append(normalized)
    return queries


def print_preset_summary(
    *,
    preset: SeedPreset,
    size: int,
    max_pages: int,
    queries: list[str],
) -> None:
    print(f"preset: {preset.name}")
    print(f"preset_description: {preset.description}")
    print(f"size: {size}")
    print(f"max_pages: {max_pages}")
    print(f"query_count: {len(queries)}")
    print(f"queries: {', '.join(queries)}")


def warn_if_small_corpus(record_count: int) -> None:
    if record_count >= LOW_CORPUS_WARNING_THRESHOLD:
        return
    print(
        "warning: corpus size is small for meaningful typo-similarity evaluation "
        f"({record_count} records loaded, threshold {LOW_CORPUS_WARNING_THRESHOLD}).",
        file=sys.stderr,
    )
    print(
        "hint: use `--preset bootstrap` for first-run setup, or increase "
        "`--size` / `--max-pages` explicitly.",
        file=sys.stderr,
    )


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
        preset, size, max_pages = resolve_collect_dimensions(
            preset_name=args.preset,
            size_override=args.size,
            max_pages_override=args.max_pages,
        )
        queries = resolve_collect_queries(
            preset=preset,
            override_queries=args.queries,
        )
        result = pipeline.collect(
            output_dir=Path(args.output_dir),
            queries=queries,
            size=size,
            max_pages=max_pages,
            timeout_seconds=args.timeout_seconds,
            request_delay_seconds=args.request_delay_seconds,
            max_retries=args.max_retries,
        )
        print_preset_summary(
            preset=preset,
            size=size,
            max_pages=max_pages,
            queries=queries,
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
        warn_if_small_corpus(result.records_seen)
        return 0

    if args.command == "refresh":
        preset, size, max_pages = resolve_collect_dimensions(
            preset_name=args.preset,
            size_override=args.size,
            max_pages_override=args.max_pages,
        )
        queries = resolve_collect_queries(
            preset=preset,
            override_queries=args.queries,
        )
        collect_result, normalize_result, load_result = pipeline.refresh(
            output_dir=Path(args.output_dir),
            queries=queries,
            size=size,
            max_pages=max_pages,
            timeout_seconds=args.timeout_seconds,
            request_delay_seconds=args.request_delay_seconds,
            max_retries=args.max_retries,
        )
        print_preset_summary(
            preset=preset,
            size=size,
            max_pages=max_pages,
            queries=queries,
        )
        print(f"collected raw npm pages: {collect_result.record_count}")
        print(f"normalized npm seed records: {normalize_result.record_count}")
        print(f"loaded npm seed records: {load_result.records_seen}")
        print(f"run_id: {load_result.run_id}")
        warn_if_small_corpus(load_result.records_seen)
        return 0

    parser.error(f"unsupported command: {args.command}")
    return 1

if __name__ == "__main__":
    raise SystemExit(main())
