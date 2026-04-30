from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import bindparam, create_engine, event, text

from app.core.config import Settings
from app.core.database_schema import build_intelligence_tables
from app.core.sqlalchemy_url import to_sqlalchemy_database_url
from app.repositories.base import _register_vector


@dataclass(frozen=True)
class DatabaseReadinessCheck:
    ok: bool
    missing_tables: list[str]


def check_database_readiness(settings: Settings) -> DatabaseReadinessCheck:
    required_tables = _required_table_names(settings.database_schema)
    engine = create_engine(to_sqlalchemy_database_url(settings.database_url))
    event.listen(engine, "connect", _register_vector)

    statement = (
        text(
            """
            SELECT tablename
            FROM pg_catalog.pg_tables
            WHERE schemaname = :schema
              AND tablename IN :table_names
            """
        )
        .bindparams(bindparam("table_names", expanding=True))
    )

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
            rows = connection.execute(
                statement,
                {
                    "schema": settings.database_schema,
                    "table_names": required_tables,
                },
            ).all()
    finally:
        engine.dispose()

    present_tables = {row.tablename for row in rows}
    missing_tables = [
        table_name
        for table_name in required_tables
        if table_name not in present_tables
    ]
    return DatabaseReadinessCheck(
        ok=len(missing_tables) == 0,
        missing_tables=missing_tables,
    )


def _required_table_names(schema: str) -> list[str]:
    tables = build_intelligence_tables(schema)
    return [
        tables.check_judge_results.name,
        tables.check_query_embeddings.name,
        tables.seed_runs.name,
        tables.package_embeddings.name,
    ]
