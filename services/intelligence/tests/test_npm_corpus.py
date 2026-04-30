from sources.npm.parsing import (
    PackageRecord,
    build_summary,
    dedupe_records,
    normalize_description,
    normalize_package_name,
    parse_search_object,
)
from sources.npm.registry import DEFAULT_QUERIES


def test_default_queries_cover_more_than_react_packages() -> None:
    assert "react" in DEFAULT_QUERIES
    assert "lodash" in DEFAULT_QUERIES
    assert "axios" in DEFAULT_QUERIES
    assert "express" in DEFAULT_QUERIES
    assert "eslint" in DEFAULT_QUERIES
    assert "commander" in DEFAULT_QUERIES
    assert len(DEFAULT_QUERIES) >= 10


def test_normalize_package_name_lowercases_and_trims() -> None:
    assert normalize_package_name("  @Scope/My-Pkg  ") == "@scope/my-pkg"


def test_normalize_description_cleans_whitespace() -> None:
    assert normalize_description("  useful \n package\ttool ") == "useful package tool"
    assert normalize_description("   ") is None
    assert normalize_description(None) is None


def test_parse_search_object_extracts_expected_fields() -> None:
    record = parse_search_object(
        {
            "package": {
                "name": "React",
                "version": "19.0.0",
                "description": " UI library ",
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
        query="react",
    )

    assert record == PackageRecord(
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


def test_parse_search_object_skips_invalid_rows() -> None:
    assert parse_search_object({}, query="react") is None
    assert parse_search_object({"package": {"name": "   "}}, query="react") is None


def test_dedupe_prefers_higher_scored_record() -> None:
    records = [
        PackageRecord(
            ecosystem="npm",
            package="lodash",
            description=None,
            version="1.0.0",
            score_final=0.4,
            score_detail_quality=None,
            score_detail_popularity=None,
            score_detail_maintenance=None,
            search_query="a",
        ),
        PackageRecord(
            ecosystem="npm",
            package="lodash",
            description="Utility library",
            version="1.0.1",
            score_final=0.8,
            score_detail_quality=None,
            score_detail_popularity=None,
            score_detail_maintenance=None,
            search_query="b",
        ),
    ]

    deduped = dedupe_records(records)

    assert deduped == [records[1]]


def test_build_summary_reports_description_coverage() -> None:
    records = [
        PackageRecord(
            ecosystem="npm",
            package="react",
            description="UI library",
            version="1.0.0",
            score_final=0.9,
            score_detail_quality=None,
            score_detail_popularity=None,
            score_detail_maintenance=None,
            search_query="react",
        ),
        PackageRecord(
            ecosystem="npm",
            package="left-pad",
            description=None,
            version="1.0.0",
            score_final=0.5,
            score_detail_quality=None,
            score_detail_popularity=None,
            score_detail_maintenance=None,
            search_query="padding",
        ),
    ]

    summary = build_summary(
        raw_objects=[{}, {}],
        records=records,
        unique_records=records,
    )

    assert summary["raw_result_count"] == 2
    assert summary["parsed_record_count"] == 2
    assert summary["unique_record_count"] == 2
    assert summary["description_coverage_count"] == 1
    assert summary["description_coverage_ratio"] == 0.5
    assert summary["query_breakdown"] == {"react": 1, "padding": 1}
