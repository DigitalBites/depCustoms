from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.core.config import Settings
from app.services.artifact_store import ArtifactStore
from app.services.npm_seed_pipeline import NpmSeedPipelineService


@dataclass(frozen=True)
class FakeCollectResult:
    artifact_path: Path
    manifest_path: Path
    record_count: int


@dataclass(frozen=True)
class FakeNormalizeResult:
    artifact_path: Path
    manifest_path: Path
    record_count: int


@dataclass(frozen=True)
class FakeLoadResult:
    run_id: str
    records_seen: int
    records_inserted: int
    records_updated: int
    records_skipped: int


def test_npm_seed_pipeline_collect_delegates(monkeypatch, tmp_path: Path) -> None:
    service = NpmSeedPipelineService(
        settings=Settings(INTELLIGENCE_STUB_MODE=True),
        artifact_store=ArtifactStore(),
    )
    expected = FakeCollectResult(
        artifact_path=tmp_path / "npm" / "raw" / "npm.ndjson.gz",
        manifest_path=tmp_path / "npm" / "raw" / "npm.manifest.json",
        record_count=12,
    )
    captured: dict[str, object] = {}

    def fake_collect_npm_search(**kwargs):
        captured.update(kwargs)
        return expected

    monkeypatch.setattr(
        "app.services.npm_seed_pipeline.collect_npm_search",
        fake_collect_npm_search,
    )

    result = service.collect(
        output_dir=tmp_path,
        queries=["react"],
        size=50,
        max_pages=2,
        timeout_seconds=5.0,
        request_delay_seconds=0.0,
        max_retries=3,
    )

    assert result == expected
    assert captured["output_dir"] == tmp_path
    assert captured["artifact_store"] is service.artifact_store
    assert captured["queries"] == ["react"]
    assert captured["size"] == 50


def test_npm_seed_pipeline_normalize_delegates(monkeypatch, tmp_path: Path) -> None:
    service = NpmSeedPipelineService(
        settings=Settings(INTELLIGENCE_STUB_MODE=True),
        artifact_store=ArtifactStore(),
    )
    input_path = tmp_path / "npm" / "raw" / "npm.ndjson.gz"
    expected = FakeNormalizeResult(
        artifact_path=tmp_path / "npm" / "normalized" / "npm.ndjson.gz",
        manifest_path=tmp_path / "npm" / "normalized" / "npm.manifest.json",
        record_count=10,
    )
    captured: dict[str, object] = {}

    def fake_normalize_npm_search(**kwargs):
        captured.update(kwargs)
        return expected

    monkeypatch.setattr(
        "app.services.npm_seed_pipeline.normalize_npm_search",
        fake_normalize_npm_search,
    )

    result = service.normalize(input_path=input_path, output_dir=tmp_path)

    assert result == expected
    assert captured["input_path"] == input_path
    assert captured["output_dir"] == tmp_path
    assert captured["artifact_store"] is service.artifact_store


def test_npm_seed_pipeline_refresh_orders_collect_normalize_load(
    monkeypatch,
    tmp_path: Path,
) -> None:
    service = NpmSeedPipelineService(
        settings=Settings(INTELLIGENCE_STUB_MODE=True),
        artifact_store=ArtifactStore(),
    )
    collect_result = FakeCollectResult(
        artifact_path=tmp_path / "npm" / "raw" / "npm.ndjson.gz",
        manifest_path=tmp_path / "npm" / "raw" / "npm.manifest.json",
        record_count=10,
    )
    normalize_result = FakeNormalizeResult(
        artifact_path=tmp_path / "npm" / "normalized" / "npm.ndjson.gz",
        manifest_path=tmp_path / "npm" / "normalized" / "npm.manifest.json",
        record_count=8,
    )
    load_result = FakeLoadResult(
        run_id="run-123",
        records_seen=8,
        records_inserted=7,
        records_updated=1,
        records_skipped=0,
    )
    call_order: list[tuple[str, Path]] = []

    monkeypatch.setattr(
        service,
        "collect",
        lambda **kwargs: (
            call_order.append(("collect", kwargs["output_dir"])),
            collect_result,
        )[1],
    )
    monkeypatch.setattr(
        service,
        "normalize",
        lambda **kwargs: (
            call_order.append(("normalize", kwargs["input_path"])),
            normalize_result,
        )[1],
    )
    monkeypatch.setattr(
        service,
        "load",
        lambda **kwargs: (
            call_order.append(("load", kwargs["input_path"])),
            load_result,
        )[1],
    )

    result = service.refresh(
        output_dir=tmp_path,
        queries=["react"],
        size=25,
        max_pages=1,
        timeout_seconds=5.0,
        request_delay_seconds=0.0,
        max_retries=2,
    )

    assert result == (collect_result, normalize_result, load_result)
    assert call_order == [
        ("collect", tmp_path),
        ("normalize", collect_result.artifact_path),
        ("load", normalize_result.artifact_path),
    ]
