from __future__ import annotations

import gzip
import json
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.models.artifacts import ArtifactManifest


@dataclass(frozen=True)
class ArtifactWriteStats:
    compressed_bytes: int
    uncompressed_bytes: int


@dataclass(frozen=True)
class ArtifactStore:
    def write_records(
        self,
        path: Path,
        records: Iterable[dict[str, Any]],
    ) -> ArtifactWriteStats:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_suffix(path.suffix + ".tmp")
        uncompressed_bytes = 0

        with gzip.open(temp_path, "wt", encoding="utf-8") as handle:
            for record in records:
                line = json.dumps(record, sort_keys=True, default=str)
                handle.write(line)
                handle.write("\n")
                uncompressed_bytes += len(line.encode("utf-8")) + 1

        temp_path.replace(path)
        return ArtifactWriteStats(
            compressed_bytes=path.stat().st_size,
            uncompressed_bytes=uncompressed_bytes,
        )

    def read_records(self, path: Path) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                stripped = line.strip()
                if not stripped:
                    continue
                payload = json.loads(stripped)
                if not isinstance(payload, dict):
                    raise ValueError(f"artifact line is not a JSON object: {path}")
                records.append(payload)
        return records

    def write_manifest(self, path: Path, manifest: ArtifactManifest) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_suffix(path.suffix + ".tmp")
        temp_path.write_text(
            json.dumps(manifest.to_dict(), indent=2, sort_keys=True),
            encoding="utf-8",
        )
        temp_path.replace(path)
