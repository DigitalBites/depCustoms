from spike.pypi_corpus import (
    PypiPackageRecord,
    build_record,
    build_summary,
    normalize_package_name,
    normalize_text,
)


def test_normalize_package_name_matches_pypi_rules() -> None:
    assert normalize_package_name("My_Package.Name") == "my-package-name"


def test_normalize_text_cleans_whitespace() -> None:
    assert normalize_text("  hello \n world\t") == "hello world"
    assert normalize_text("") is None
    assert normalize_text(None) is None


def test_build_record_extracts_metadata_and_downloads() -> None:
    record = build_record(
        "Requests",
        {
            "info": {
                "summary": " HTTP library ",
                "description": " Great \n client ",
                "version": "2.32.0",
            }
        },
        {"last_day": 10, "last_week": 50, "last_month": 250},
    )

    assert record == PypiPackageRecord(
        ecosystem="pypi",
        package="requests",
        summary="HTTP library",
        description="Great client",
        version="2.32.0",
        downloads_last_day=10,
        downloads_last_week=50,
        downloads_last_month=250,
    )


def test_build_summary_reports_coverage() -> None:
    records = [
        PypiPackageRecord(
            ecosystem="pypi",
            package="requests",
            summary="HTTP library",
            description="Long description",
            version="1.0.0",
            downloads_last_day=1,
            downloads_last_week=7,
            downloads_last_month=30,
        ),
        PypiPackageRecord(
            ecosystem="pypi",
            package="pkg-no-desc",
            summary=None,
            description=None,
            version="1.0.0",
            downloads_last_day=None,
            downloads_last_week=None,
            downloads_last_month=None,
        ),
    ]

    summary = build_summary(records, simple_index_project_count=123)

    assert summary["simple_index_project_count"] == 123
    assert summary["seed_package_count"] == 2
    assert summary["summary_coverage_ratio"] == 0.5
    assert summary["description_coverage_ratio"] == 0.5
    assert summary["downloads_coverage_ratio"] == 0.5
