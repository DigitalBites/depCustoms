from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from pgvector.psycopg import register_vector
from sqlalchemy import Engine, create_engine, event

from app.core.database_schema import IntelligenceTables, build_intelligence_tables
from app.core.sqlalchemy_url import to_sqlalchemy_database_url


def _register_vector(
    dbapi_connection: object,
    connection_record: object,
) -> None:
    del connection_record
    register_vector(dbapi_connection)


@dataclass
class RepositoryContext:
    database_url: str
    database_schema: str
    _engine: Engine | None = field(default=None, init=False, repr=False)
    _tables: IntelligenceTables | None = field(default=None, init=False, repr=False)

    @property
    def engine(self) -> Engine:
        if self._engine is None:
            engine = create_engine(to_sqlalchemy_database_url(self.database_url))
            event.listen(engine, "connect", _register_vector)
            self._engine = engine
        return self._engine

    @property
    def tables(self) -> IntelligenceTables:
        if self._tables is None:
            self._tables = build_intelligence_tables(self.database_schema)
        return self._tables

    def fetch_all(self, statement: Any) -> Sequence[Any]:
        with self.engine.connect() as connection:
            return connection.execute(statement).all()

    def fetch_one(self, statement: Any) -> Any | None:
        with self.engine.connect() as connection:
            return connection.execute(statement).first()

    def fetch_one_or_none(self, statement: Any) -> Any | None:
        with self.engine.connect() as connection:
            return connection.execute(statement).one_or_none()

    def fetch_scalar(self, statement: Any) -> Any:
        with self.engine.connect() as connection:
            return connection.execute(statement).scalar_one()

    def execute(self, statement: Any) -> None:
        with self.engine.begin() as connection:
            connection.execute(statement)

    def execute_scalar(self, statement: Any) -> Any:
        with self.engine.begin() as connection:
            return connection.execute(statement).scalar_one()
