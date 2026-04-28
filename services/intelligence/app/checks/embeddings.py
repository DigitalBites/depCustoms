from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Literal

from langchain_openai import OpenAIEmbeddings

from ..core.config import Settings

EmbeddingTextMode = Literal["package_description", "name_only"]


def build_embedding_text_for_mode(
    ecosystem: str,
    package: str,
    description: str | None,
    mode: EmbeddingTextMode,
) -> str:
    if mode == "name_only":
        return f"{ecosystem}: {package}"
    desc = (description or "").strip()
    if desc:
        return f"{ecosystem}: {package} - {desc}"
    return f"{ecosystem}: {package}"


def build_embedding_text(ecosystem: str, package: str, description: str | None) -> str:
    return build_embedding_text_for_mode(
        ecosystem=ecosystem,
        package=package,
        description=description,
        mode="package_description",
    )


class EmbeddingClient:
    def embed_query(self, text: str) -> list[float]:
        raise NotImplementedError

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return [self.embed_query(text) for text in texts]


@dataclass
class StubEmbeddingClient(EmbeddingClient):
    dimensions: int = 8

    def embed_query(self, text: str) -> list[float]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        values: list[float] = []
        for index in range(self.dimensions):
            byte = digest[index]
            values.append(round(byte / 255.0, 6))
        return values


@dataclass
class OpenAIEmbeddingClient(EmbeddingClient):
    embeddings: OpenAIEmbeddings

    @classmethod
    def from_settings(cls, settings: Settings) -> OpenAIEmbeddingClient:
        client = OpenAIEmbeddings(
            model=settings.embedding_model_name,
            api_key=settings.openai_api_key,
        )
        return cls(embeddings=client)

    def embed_query(self, text: str) -> list[float]:
        return [float(value) for value in self.embeddings.embed_query(text)]

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return [
            [float(value) for value in embedding]
            for embedding in self.embeddings.embed_documents(texts)
        ]
