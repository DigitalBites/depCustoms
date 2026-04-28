from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pytest

from sources.npm.collect import (
    COLLECTOR_VERSION,
    DEFAULT_COLLECT_MAX_PAGES,
    DEFAULT_COLLECT_MAX_RETRIES,
    DEFAULT_COLLECT_QUERIES,
    DEFAULT_COLLECT_REQUEST_DELAY_SECONDS,
    DEFAULT_COLLECT_SIZE,
    collect_npm_search,
)


@dataclass(frozen=True)
class FakeWriteStats:
    compressed_bytes: int
    uncompressed_bytes: int


class FakeArtifactStore:
    def __init__(self) -> None:
        self.records_path: Path | None = None
        self.records: list[dict[str, object]] | None = None
        self.manifest_path: Path | None = None
        self.manifest = None

    def write_records(
        self,
        path: Path,
        records: list[dict[str, object]],
    ) -> FakeWriteStats:
        self.records_path = path
        self.records = records
        return FakeWriteStats(compressed_bytes=123, uncompressed_bytes=456)

    def write_manifest(self, path: Path, manifest) -> None:
        self.manifest_path = path
        self.manifest = manifest


def test_collect_npm_search_writes_records_and_manifest(
    monkeypatch,
    tmp_path: Path,
) -> None:
    store = FakeArtifactStore()
    calls: list[tuple[str, int]] = []

    def fake_fetch_search_page(
        *,
        query: str,
        size: int,
        offset: int,
        timeout_seconds: float,
        max_retries: int,
    ) -> dict[str, object]:
        del size, timeout_seconds, max_retries
        calls.append((query, offset))
        if offset == 0:
            return {"objects": [{"package": {"name": f"{query}-pkg"}}]}
        return {"objects": []}

    monkeypatch.setattr(
        "sources.npm.collect.fetch_search_page",
        fake_fetch_search_page,
    )
    sleep_calls: list[float] = []
    monkeypatch.setattr(
        "sources.npm.collect.time.sleep",
        lambda seconds: sleep_calls.append(seconds),
    )
    monkeypatch.setattr(
        "sources.npm.collect.utc_now_iso",
        lambda: "2026-04-23T00:00:00Z",
    )

    result = collect_npm_search(
        output_dir=tmp_path,
        artifact_store=store,
        queries=["react", "lodash"],
        size=25,
        max_pages=3,
        timeout_seconds=5.0,
        request_delay_seconds=0.25,
        max_retries=2,
    )

    assert result.record_count == 2
    assert calls == [("react", 0), ("react", 25), ("lodash", 0), ("lodash", 25)]
    assert sleep_calls == [0.25, 0.25]
    assert store.records_path == (
        tmp_path / "npm" / "raw" / "npm-search-pages.ndjson.gz"
    )
    assert store.manifest_path == (
        tmp_path / "npm" / "raw" / "npm-search-pages.manifest.json"
    )
    assert store.records is not None
    assert len(store.records) == 2
    assert store.records[0]["query"] == "react"
    assert store.records[1]["query"] == "lodash"
    assert store.manifest is not None
    assert store.manifest.collector_version == COLLECTOR_VERSION
    assert store.manifest.record_count == 2
    assert store.manifest.metadata["queries"] == ["react", "lodash"]


def test_collect_npm_search_rejects_invalid_object_shape(
    monkeypatch,
    tmp_path: Path,
) -> None:
    store = FakeArtifactStore()

    monkeypatch.setattr(
        "sources.npm.collect.fetch_search_page",
        lambda **kwargs: {"objects": "bad-shape"},
    )

    with pytest.raises(ValueError, match="missing objects list"):
        collect_npm_search(
            output_dir=tmp_path,
            artifact_store=store,
            queries=["react"],
            request_delay_seconds=0.0,
        )


def test_collect_npm_search_uses_tuned_defaults(
    monkeypatch,
    tmp_path: Path,
) -> None:
    store = FakeArtifactStore()
    calls: list[tuple[str, int, int, int]] = []

    def fake_fetch_search_page(
        *,
        query: str,
        size: int,
        offset: int,
        timeout_seconds: float,
        max_retries: int,
    ) -> dict[str, object]:
        del timeout_seconds
        calls.append((query, size, offset, max_retries))
        if offset == 0:
            return {"objects": [{"package": {"name": query}}]}
        return {"objects": []}

    monkeypatch.setattr(
        "sources.npm.collect.fetch_search_page",
        fake_fetch_search_page,
    )
    sleep_calls: list[float] = []
    monkeypatch.setattr(
        "sources.npm.collect.time.sleep",
        lambda seconds: sleep_calls.append(seconds),
    )

    result = collect_npm_search(
        output_dir=tmp_path,
        artifact_store=store,
    )

    assert result.record_count == len(DEFAULT_COLLECT_QUERIES)
    assert calls == [
        item
        for query in DEFAULT_COLLECT_QUERIES
        for item in [
            (query, DEFAULT_COLLECT_SIZE, 0, DEFAULT_COLLECT_MAX_RETRIES),
            (
                query,
                DEFAULT_COLLECT_SIZE,
                DEFAULT_COLLECT_SIZE,
                DEFAULT_COLLECT_MAX_RETRIES,
            ),
        ]
    ]
    assert sleep_calls == [
        DEFAULT_COLLECT_REQUEST_DELAY_SECONDS
    ] * len(DEFAULT_COLLECT_QUERIES)
    assert store.manifest is not None
    assert store.manifest.metadata["queries"] == DEFAULT_COLLECT_QUERIES
    assert store.manifest.metadata["size"] == DEFAULT_COLLECT_SIZE
    assert store.manifest.metadata["max_pages"] == DEFAULT_COLLECT_MAX_PAGES
    assert (
        store.manifest.metadata["request_delay_seconds"]
        == DEFAULT_COLLECT_REQUEST_DELAY_SECONDS
    )
    assert store.manifest.metadata["max_retries"] == DEFAULT_COLLECT_MAX_RETRIES
