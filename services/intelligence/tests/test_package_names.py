from __future__ import annotations

from app.domain.package_names import (
    lexical_similarity_score,
    looks_like_typo_variant,
    normalize_package_name_for_similarity,
)


def test_normalize_package_name_for_similarity_removes_separators() -> None:
    assert normalize_package_name_for_similarity("@scope/react-dom") == "scopereactdom"


def test_lexical_similarity_score_handles_transposition() -> None:
    assert lexical_similarity_score("recat", "react") >= 0.8
    assert lexical_similarity_score("lodahs", "lodash") >= 0.8


def test_looks_like_typo_variant_accepts_small_spelling_changes() -> None:
    assert looks_like_typo_variant("recat", "react") is True
    assert looks_like_typo_variant("reakt", "react") is True
    assert looks_like_typo_variant("lodahs", "lodash") is True


def test_looks_like_typo_variant_rejects_prefixed_package_family() -> None:
    assert looks_like_typo_variant("react", "preact") is False
