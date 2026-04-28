from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.models.artifacts import ArtifactManifest
from app.models.seed_records import utc_now_iso
from app.services.artifact_store import ArtifactStore
from sources.npm.registry import fetch_search_page

COLLECTOR_VERSION = "npm-collect-v1"
DEFAULT_COLLECT_QUERIES = [
    "keywords:javascript",
    "keywords:typescript",
    "react",
    "express",
    "lodash",
    "axios",
]
DEFAULT_COLLECT_SIZE = 50
DEFAULT_COLLECT_MAX_PAGES = 2
DEFAULT_COLLECT_TIMEOUT_SECONDS = 10.0
DEFAULT_COLLECT_REQUEST_DELAY_SECONDS = 1.5
DEFAULT_COLLECT_MAX_RETRIES = 6
logger: logging.Logger = logging.getLogger("customs.intelligence.collect.npm")


@dataclass(frozen=True)
class NpmCollectResult:
    artifact_path: Path
    manifest_path: Path
    record_count: int


def collect_npm_search(
    output_dir: Path,
    artifact_store: ArtifactStore,
    queries: list[str] | None = None,
    size: int = DEFAULT_COLLECT_SIZE,
    max_pages: int = DEFAULT_COLLECT_MAX_PAGES,
    timeout_seconds: float = DEFAULT_COLLECT_TIMEOUT_SECONDS,
    request_delay_seconds: float = DEFAULT_COLLECT_REQUEST_DELAY_SECONDS,
    max_retries: int = DEFAULT_COLLECT_MAX_RETRIES,
) -> NpmCollectResult:
    effective_queries = queries or list(DEFAULT_COLLECT_QUERIES)
    collected_at = utc_now_iso()
    artifact_dir = output_dir / "npm" / "raw"
    artifact_path = artifact_dir / "npm-search-pages.ndjson.gz"
    manifest_path = artifact_dir / "npm-search-pages.manifest.json"

    logger.info(
        "starting npm collection",
        extra={
            "query_count": len(effective_queries),
            "size": size,
            "max_pages": max_pages,
            "timeout_seconds": timeout_seconds,
            "request_delay_seconds": request_delay_seconds,
            "max_retries": max_retries,
            "artifact_path": str(artifact_path),
        },
    )
    page_records: list[dict[str, Any]] = []
    for query_index, query in enumerate(effective_queries, start=1):
        logger.info(
            "collecting npm query",
            extra={
                "query": query,
                "query_index": query_index,
                "query_count": len(effective_queries),
            },
        )
        for page_index in range(max_pages):
            offset = page_index * size
            response = fetch_search_page(
                query=query,
                size=size,
                offset=offset,
                timeout_seconds=timeout_seconds,
                max_retries=max_retries,
            )
            objects = response.get("objects")
            if not isinstance(objects, list):
                raise ValueError("npm search response missing objects list")
            if not objects:
                logger.info(
                    "npm query returned no additional objects",
                    extra={
                        "query": query,
                        "page_index": page_index,
                        "offset": offset,
                    },
                )
                break

            page_records.append(
                {
                    "query": query,
                    "page_index": page_index,
                    "offset": offset,
                    "size": size,
                    "collected_at": collected_at,
                    "response": response,
                }
            )
            logger.info(
                "collected npm search page",
                extra={
                    "query": query,
                    "page_index": page_index,
                    "offset": offset,
                    "object_count": len(objects),
                    "pages_collected": len(page_records),
                },
            )
            if request_delay_seconds > 0:
                logger.info(
                    "sleeping between npm requests",
                    extra={
                        "delay_seconds": request_delay_seconds,
                        "query": query,
                        "page_index": page_index,
                    },
                )
                time.sleep(request_delay_seconds)

    write_stats = artifact_store.write_records(
        artifact_path,
        page_records,
    )
    artifact_store.write_manifest(
        manifest_path,
        ArtifactManifest(
            ecosystem="npm",
            artifact_kind="raw",
            collected_at=collected_at,
            collector_version=COLLECTOR_VERSION,
            source="registry.npmjs.org/-/v1/search",
            artifact_path=str(artifact_path),
            record_count=len(page_records),
            compressed_bytes=write_stats.compressed_bytes,
            uncompressed_bytes=write_stats.uncompressed_bytes,
            metadata={
                "queries": effective_queries,
                "size": size,
                "max_pages": max_pages,
                "timeout_seconds": timeout_seconds,
                "request_delay_seconds": request_delay_seconds,
                "max_retries": max_retries,
            },
        ),
    )
    logger.info(
        "finished npm collection",
        extra={
            "record_count": len(page_records),
            "artifact_path": str(artifact_path),
            "manifest_path": str(manifest_path),
            "compressed_bytes": write_stats.compressed_bytes,
        },
    )

    return NpmCollectResult(
        artifact_path=artifact_path,
        manifest_path=manifest_path,
        record_count=len(page_records),
    )
