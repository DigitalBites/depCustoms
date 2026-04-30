from __future__ import annotations

from pydantic import ValidationError

from app.core.config import Settings


def test_settings_defaults_include_intelligence_schema_and_port() -> None:
    settings = Settings(INTELLIGENCE_STUB_MODE=True)

    assert settings.database_schema == "intel"
    assert settings.port == 8001
    assert settings.stub_mode is True
    assert settings.auto_migrate_on_startup is True
    assert settings.embedding_model == "openai/text-embedding-3-small"
    assert settings.embedding_model_name == "text-embedding-3-small"
    assert settings.judge_model == "openai/gpt-4o-mini"
    assert settings.judge_model_name == "gpt-4o-mini"
    assert settings.judge_lexical_backstop_threshold == 0.6


def test_settings_to_log_sanitizes_secret_values() -> None:
    settings = Settings(
        OPENAI_API_KEY="openai-secret",
        DATABASE_URL="postgresql://example",
        INTELLIGENCE_DB_SCHEMA="custom_intel",
    )

    snapshot = settings.to_log()

    assert snapshot["database"] == {
        "configured": True,
        "schema": "custom_intel",
    }
    assert snapshot["embeddings"] == {
        "openai_api_key_configured": True,
        "openai_api_key_fingerprint": "9cbbbfb350d0",
        "embedding_model": "openai/text-embedding-3-small",
        "embedding_provider": "openai",
    }
    assert snapshot["judge"] == {
        "openai_api_key_configured": True,
        "openai_api_key_fingerprint": "9cbbbfb350d0",
        "judge_model": "openai/gpt-4o-mini",
        "judge_provider": "openai",
    }
    assert snapshot["service"]["auto_migrate_on_startup"] is True
    assert snapshot["search"]["judge_lexical_backstop_threshold"] == 0.6


def test_settings_reject_empty_schema() -> None:
    try:
        Settings(INTELLIGENCE_DB_SCHEMA="   ")
    except ValidationError as exc:
        assert "INTELLIGENCE_DB_SCHEMA must not be empty" in str(exc)
    else:
        raise AssertionError("expected validation error for empty schema")


def test_settings_reject_invalid_schema_identifier() -> None:
    try:
        Settings(INTELLIGENCE_DB_SCHEMA="intel-schema")
    except ValidationError as exc:
        assert "must be a valid PostgreSQL schema identifier" in str(exc)
    else:
        raise AssertionError("expected validation error for invalid schema identifier")


def test_settings_reject_invalid_port() -> None:
    try:
        Settings(INTELLIGENCE_PORT="70000")
    except ValidationError as exc:
        assert "INTELLIGENCE_PORT must be between 1 and 65535" in str(exc)
    else:
        raise AssertionError("expected validation error for invalid port")


def test_settings_reject_non_qualified_model_id() -> None:
    try:
        Settings(EMBEDDING_MODEL="text-embedding-3-small")
    except ValidationError as exc:
        assert "model ids must be provider-qualified" in str(exc)
    else:
        raise AssertionError("expected validation error for non-qualified model id")


def test_settings_reject_unsupported_provider() -> None:
    try:
        Settings(JUDGE_MODEL="anthropic/claude-3-5-haiku-latest")
    except ValidationError as exc:
        assert "unsupported model provider" in str(exc)
    else:
        raise AssertionError("expected validation error for unsupported provider")
