from __future__ import annotations

from alembic import context
from sqlalchemy import engine_from_config, pool, text

from app.core.config import get_settings
from app.core.sqlalchemy_url import to_sqlalchemy_database_url

config = context.config

settings = get_settings()
if not config.get_main_option("sqlalchemy.url"):
    config.set_main_option(
        "sqlalchemy.url",
        to_sqlalchemy_database_url(settings.database_url),
    )
if not config.get_main_option("intelligence_db_schema"):
    config.set_main_option("intelligence_db_schema", settings.database_schema)


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema=settings.database_schema,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        connection.execute(
            text(f'CREATE SCHEMA IF NOT EXISTS "{settings.database_schema}"')
        )
        connection.commit()
        context.configure(
            connection=connection,
            version_table_schema=settings.database_schema,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
