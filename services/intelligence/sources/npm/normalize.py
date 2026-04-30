from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path

from app.checks.embeddings import build_embedding_text
from app.models.artifacts import ArtifactManifest
from app.models.seed_records import NormalizedSeedRecord, hash_seed_record, utc_now_iso
from app.services.artifact_store import ArtifactStore
from sources.npm.parsing import PackageRecord, dedupe_records, parse_search_object

NORMALIZER_VERSION = "npm-normalize-v1"


@dataclass(frozen=True)
class NpmNormalizeResult:
    artifact_path: Path
    manifest_path: Path
    record_count: int


def normalize_npm_search(
    input_path: Path,
    output_dir: Path,
    artifact_store: ArtifactStore,
) -> NpmNormalizeResult:
    raw_pages = artifact_store.read_records(input_path)
    parsed_records: list[PackageRecord] = []

    for page in raw_pages:
        query = page.get("query")
        response = page.get("response")
        if not isinstance(query, str):
            raise ValueError("raw npm page record missing query")
        if not isinstance(response, dict):
            raise ValueError("raw npm page record missing response")
        objects = response.get("objects")
        if not isinstance(objects, list):
            raise ValueError("raw npm page response missing objects")

        for index, obj in enumerate(objects):
            if not isinstance(obj, dict):
                continue
            record = parse_search_object(obj, query=query)
            if record is None:
                continue
            parsed_records.append(_with_rank(record, index + 1))

    normalized_records = [
        _to_normalized_seed_record(record) for record in dedupe_records(parsed_records)
    ]

    artifact_dir = output_dir / "npm" / "normalized"
    artifact_path = artifact_dir / "npm-seed-records.ndjson.gz"
    manifest_path = artifact_dir / "npm-seed-records.manifest.json"
    collected_at = utc_now_iso()

    write_stats = artifact_store.write_records(
        artifact_path,
        [record.to_dict() for record in normalized_records],
    )
    artifact_store.write_manifest(
        manifest_path,
        ArtifactManifest(
            ecosystem="npm",
            artifact_kind="normalized",
            collected_at=collected_at,
            collector_version=NORMALIZER_VERSION,
            source=str(input_path),
            artifact_path=str(artifact_path),
            record_count=len(normalized_records),
            compressed_bytes=write_stats.compressed_bytes,
            uncompressed_bytes=write_stats.uncompressed_bytes,
            metadata={
                "input_path": str(input_path),
                "raw_page_count": len(raw_pages),
                "parsed_record_count": len(parsed_records),
            },
        ),
    )

    return NpmNormalizeResult(
        artifact_path=artifact_path,
        manifest_path=manifest_path,
        record_count=len(normalized_records),
    )


def _with_rank(record: PackageRecord, rank: int) -> PackageRecord:
    payload = asdict(record)
    payload["source_rank"] = rank
    return PackageRecordWithRank(**payload)


@dataclass(frozen=True)
class PackageRecordWithRank(PackageRecord):
    source_rank: int | None = None


def _to_normalized_seed_record(record: PackageRecord) -> NormalizedSeedRecord:
    rank = getattr(record, "source_rank", None)
    collected_at = utc_now_iso()
    popularity_signal = {
        "score_final": record.score_final,
        "quality": record.score_detail_quality,
        "popularity": record.score_detail_popularity,
        "maintenance": record.score_detail_maintenance,
    }
    embedding_text = build_embedding_text(
        ecosystem=record.ecosystem,
        package=record.package,
        description=record.description,
    )
    hash_payload = {"embedding_text": embedding_text}
    source_record_hash = hash_seed_record(hash_payload)
    return NormalizedSeedRecord(
        ecosystem=record.ecosystem,
        package=record.package,
        description=record.description,
        version=record.version,
        source="seed_npm",
        source_query=record.search_query,
        source_rank=rank,
        popularity_signal=popularity_signal,
        collected_at=collected_at,
        source_record_hash=source_record_hash,
    )
