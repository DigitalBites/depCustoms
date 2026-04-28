from __future__ import annotations

from dataclasses import dataclass

from ..repositories.base import RepositoryContext
from ..repositories.check_judge_results import CheckJudgeResultRepository
from ..repositories.check_query_embeddings import CheckQueryEmbeddingRepository
from ..repositories.package_embeddings import PackageEmbeddingRepository
from ..repositories.seed_runs import SeedRunRepository
from .config import Settings


@dataclass(frozen=True)
class IntelligenceDatabase:
    context: RepositoryContext

    @classmethod
    def from_settings(cls, settings: Settings) -> IntelligenceDatabase:
        return cls(
            context=RepositoryContext(
                database_url=settings.database_url,
                database_schema=settings.database_schema,
            )
        )

    def package_embeddings(self) -> PackageEmbeddingRepository:
        return PackageEmbeddingRepository(self.context)

    def check_query_embeddings(self) -> CheckQueryEmbeddingRepository:
        return CheckQueryEmbeddingRepository(self.context)

    def check_judge_results(self) -> CheckJudgeResultRepository:
        return CheckJudgeResultRepository(self.context)

    def seed_runs(self) -> SeedRunRepository:
        return SeedRunRepository(self.context)
