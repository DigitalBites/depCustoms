from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.checks.embeddings import OpenAIEmbeddingClient
from app.core.config import Settings
from app.core.db import IntelligenceDatabase
from app.models.seed_records import NormalizedSeedRecord
from app.services.artifact_store import ArtifactStore
from app.services.seed_loader import SeedLoaderService, SeedLoadResult
from sources.npm.collect import NpmCollectResult, collect_npm_search
from sources.npm.normalize import NpmNormalizeResult, normalize_npm_search


@dataclass
class NpmSeedPipelineService:
    settings: Settings
    artifact_store: ArtifactStore

    def collect(
        self,
        *,
        output_dir: Path,
        queries: list[str] | None,
        size: int,
        max_pages: int,
        timeout_seconds: float,
        request_delay_seconds: float,
        max_retries: int,
    ) -> NpmCollectResult:
        return collect_npm_search(
            output_dir=output_dir,
            artifact_store=self.artifact_store,
            queries=queries,
            size=size,
            max_pages=max_pages,
            timeout_seconds=timeout_seconds,
            request_delay_seconds=request_delay_seconds,
            max_retries=max_retries,
        )

    def normalize(
        self,
        *,
        input_path: Path,
        output_dir: Path,
    ) -> NpmNormalizeResult:
        return normalize_npm_search(
            input_path=input_path,
            output_dir=output_dir,
            artifact_store=self.artifact_store,
        )

    def load(self, *, input_path: Path) -> SeedLoadResult:
        records = [
            NormalizedSeedRecord(**record)
            for record in self.artifact_store.read_records(input_path)
        ]
        if self.settings.stub_mode:
            raise ValueError(
                "load requires INTELLIGENCE_STUB_MODE=false so embeddings match the "
                "database vector dimensions"
            )
        embedding_client = OpenAIEmbeddingClient.from_settings(self.settings)
        database = IntelligenceDatabase.from_settings(self.settings)
        loader = SeedLoaderService(
            package_embeddings=database.package_embeddings(),
            seed_runs=database.seed_runs(),
        )
        return loader.load_records(
            ecosystem="npm",
            operation="load",
            source="normalized_artifact",
            artifact_path=str(input_path),
            records=records,
            embedding_model=self.settings.embedding_model,
            embedding_client=embedding_client,
        )

    def refresh(
        self,
        *,
        output_dir: Path,
        queries: list[str] | None,
        size: int,
        max_pages: int,
        timeout_seconds: float,
        request_delay_seconds: float,
        max_retries: int,
    ) -> tuple[NpmCollectResult, NpmNormalizeResult, SeedLoadResult]:
        collect_result = self.collect(
            output_dir=output_dir,
            queries=queries,
            size=size,
            max_pages=max_pages,
            timeout_seconds=timeout_seconds,
            request_delay_seconds=request_delay_seconds,
            max_retries=max_retries,
        )
        normalize_result = self.normalize(
            input_path=collect_result.artifact_path,
            output_dir=output_dir,
        )
        load_result = self.load(input_path=normalize_result.artifact_path)
        return collect_result, normalize_result, load_result
