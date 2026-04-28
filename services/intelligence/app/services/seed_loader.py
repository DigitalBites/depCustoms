from __future__ import annotations

from dataclasses import dataclass

from app.checks.embeddings import EmbeddingClient, build_embedding_text
from app.models.seed_records import NormalizedSeedRecord
from app.repositories.package_embeddings import PackageEmbeddingRepository
from app.repositories.seed_runs import SeedRunRepository

DEFAULT_EMBEDDING_BATCH_SIZE = 50


@dataclass(frozen=True)
class SeedLoadResult:
    run_id: str
    records_seen: int
    records_inserted: int
    records_updated: int
    records_skipped: int


@dataclass
class SeedLoaderService:
    package_embeddings: PackageEmbeddingRepository
    seed_runs: SeedRunRepository

    def load_records(
        self,
        *,
        ecosystem: str,
        operation: str,
        source: str,
        artifact_path: str | None,
        records: list[NormalizedSeedRecord],
        embedding_model: str,
        embedding_client: EmbeddingClient,
    ) -> SeedLoadResult:
        run_id = self.seed_runs.create(
            ecosystem=ecosystem,
            operation=operation,
            source=source,
            artifact_path=artifact_path,
        )
        try:
            existing_by_key = self.package_embeddings.fetch_existing_seed_records(
                records
            )
            records_to_embed = [
                record
                for record in records
                if (
                    existing_state := existing_by_key.get(
                        (record.ecosystem, record.package)
                    )
                )
                is None
                or existing_state.source_record_hash != record.source_record_hash
            ]
            embeddings = self._build_embeddings(
                records=records_to_embed,
                embedding_client=embedding_client,
            )
            inserted, updated, skipped = self.package_embeddings.upsert_seed_records(
                records=records,
                embeddings_by_package=embeddings,
                embedding_model=embedding_model,
                run_id=run_id,
            )
            self.seed_runs.complete(
                run_id=run_id,
                status="succeeded",
                records_seen=len(records),
                records_inserted=inserted,
                records_updated=updated,
                records_skipped=skipped,
            )
        except Exception as exc:
            self.seed_runs.complete(
                run_id=run_id,
                status="failed",
                records_seen=len(records),
                records_inserted=0,
                records_updated=0,
                records_skipped=0,
                error_summary=str(exc),
            )
            raise

        return SeedLoadResult(
            run_id=run_id,
            records_seen=len(records),
            records_inserted=inserted,
            records_updated=updated,
            records_skipped=skipped,
        )

    @staticmethod
    def _build_embeddings(
        *,
        records: list[NormalizedSeedRecord],
        embedding_client: EmbeddingClient,
    ) -> dict[tuple[str, str], list[float]]:
        embeddings: dict[tuple[str, str], list[float]] = {}
        for start in range(0, len(records), DEFAULT_EMBEDDING_BATCH_SIZE):
            batch = records[start : start + DEFAULT_EMBEDDING_BATCH_SIZE]
            texts = [
                build_embedding_text(
                    ecosystem=record.ecosystem,
                    package=record.package,
                    description=record.description,
                )
                for record in batch
            ]
            batch_embeddings = embedding_client.embed_texts(texts)
            for record, embedding in zip(batch, batch_embeddings, strict=True):
                embeddings[(record.ecosystem, record.package)] = embedding
        return embeddings
