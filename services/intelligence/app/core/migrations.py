from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config

from app.core.config import Settings
from app.core.sqlalchemy_url import to_sqlalchemy_database_url


def run_database_migrations(settings: Settings) -> None:
    service_root = Path(__file__).resolve().parents[2]
    config = Config(str(service_root / "alembic.ini"))
    config.set_main_option("script_location", str(service_root / "migrations"))
    config.set_main_option(
        "sqlalchemy.url",
        to_sqlalchemy_database_url(settings.database_url),
    )
    config.set_main_option("intelligence_db_schema", settings.database_schema)
    command.upgrade(config, "head")
