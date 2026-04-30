from __future__ import annotations

from pathlib import Path

from app.services.artifact_store import ArtifactStore
from sources.npm.normalize import _to_normalized_seed_record, normalize_npm_search
from sources.npm.parsing import PackageRecord


def test_normalize_npm_search_writes_seed_records(tmp_path: Path) -> None:
    raw_path = tmp_path / "npm" / "raw" / "npm-search-pages.ndjson.gz"
    store = ArtifactStore()
    raw_pages = [
        {
            "query": "react",
            "page_index": 0,
            "offset": 0,
            "size": 2,
            "collected_at": "2026-04-21T00:00:00+00:00",
            "response": {
                "objects": [
                    {
                        "package": {
                            "name": "React",
                            "version": "19.0.0",
                            "description": "UI library",
                        },
                        "score": {
                            "final": 0.98,
                            "detail": {
                                "quality": 0.94,
                                "popularity": 0.99,
                                "maintenance": 0.87,
                            },
                        },
                    },
                    {
                        "package": {
                            "name": "react",
                            "version": "19.0.1",
                            "description": "UI library updated",
                        },
                        "score": {
                            "final": 0.99,
                            "detail": {
                                "quality": 0.95,
                                "popularity": 1.0,
                                "maintenance": 0.88,
                            },
                        },
                    },
                ]
            },
        }
    ]
    store.write_records(raw_path, raw_pages)

    result = normalize_npm_search(
        input_path=raw_path,
        output_dir=tmp_path,
        artifact_store=store,
    )

    assert result.record_count == 1
    records = store.read_records(result.artifact_path)
    assert len(records) == 1
    assert records[0]["ecosystem"] == "npm"
    assert records[0]["package"] == "react"
    assert records[0]["source"] == "seed_npm"
    assert records[0]["source_query"] == "react"
    assert records[0]["source_rank"] == 2
    assert records[0]["source_record_hash"] != ""


def test_normalized_seed_record_hash_excludes_collection_time() -> None:
    record = PackageRecord(
        ecosystem="npm",
        package="react",
        description="UI library",
        version="19.0.0",
        score_final=0.98,
        score_detail_quality=0.94,
        score_detail_popularity=0.99,
        score_detail_maintenance=0.87,
        search_query="react",
    )

    first = _to_normalized_seed_record(record)
    second = _to_normalized_seed_record(record)

    assert first.source_record_hash == second.source_record_hash
    assert first.collected_at != second.collected_at


def test_normalized_seed_record_hash_excludes_rank_and_query_metadata() -> None:
    base_record = PackageRecord(
        ecosystem="npm",
        package="commander",
        description="The complete solution for node.js command-line programs.",
        version="12.0.0",
        score_final=0.90,
        score_detail_quality=0.92,
        score_detail_popularity=0.88,
        score_detail_maintenance=0.87,
        search_query="commander",
    )

    first = _to_normalized_seed_record(base_record)
    second = _to_normalized_seed_record(
        PackageRecord(
            ecosystem="npm",
            package="commander",
            description="The complete solution for node.js command-line programs.",
            version="12.0.1",
            score_final=0.61,
            score_detail_quality=0.40,
            score_detail_popularity=0.55,
            score_detail_maintenance=0.33,
            search_query="keywords:node",
        )
    )

    assert first.source_record_hash == second.source_record_hash


def test_normalized_seed_record_hash_changes_when_embedding_text_changes() -> None:
    first = _to_normalized_seed_record(
        PackageRecord(
            ecosystem="npm",
            package="lodash",
            description="Lodash modular utilities.",
            version="4.17.21",
            score_final=0.90,
            score_detail_quality=0.92,
            score_detail_popularity=0.88,
            score_detail_maintenance=0.87,
            search_query="lodash",
        )
    )
    second = _to_normalized_seed_record(
        PackageRecord(
            ecosystem="npm",
            package="lodash",
            description="Utility library",
            version="4.17.22",
            score_final=0.61,
            score_detail_quality=0.40,
            score_detail_popularity=0.55,
            score_detail_maintenance=0.33,
            search_query="keywords:utility",
        )
    )

    assert first.source_record_hash != second.source_record_hash
