from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

IntelligenceCapability = Literal["intelligence.check", "intelligence.seed"]
InternalTokenType = Literal["api_connector", "api_admin"]

INTELLIGENCE_CAPABILITY_KEYS: tuple[IntelligenceCapability, ...] = (
    "intelligence.check",
    "intelligence.seed",
)


@dataclass(frozen=True)
class InternalTokenTypeMetadata:
    service: str
    capabilities: frozenset[IntelligenceCapability]


TOKEN_TYPE_METADATA: dict[InternalTokenType, InternalTokenTypeMetadata] = {
    "api_connector": InternalTokenTypeMetadata(
        service="api",
        capabilities=frozenset({"intelligence.check"}),
    ),
    "api_admin": InternalTokenTypeMetadata(
        service="api",
        capabilities=frozenset({"intelligence.check", "intelligence.seed"}),
    ),
}


def is_internal_token_type(value: str) -> bool:
    return value in TOKEN_TYPE_METADATA


def get_token_type_metadata(token_type: InternalTokenType) -> InternalTokenTypeMetadata:
    return TOKEN_TYPE_METADATA[token_type]
