# ruff: noqa: E402
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.checks.embeddings import (
    EmbeddingTextMode,
    OpenAIEmbeddingClient,
    build_embedding_text_for_mode,
)
from app.core.config import get_settings
from app.domain.corpus_policy import is_search_eligible
from app.evaluation.retrieval import (
    EvaluatedNeighbor,
    RetrievalSelection,
    select_candidate,
)
from app.models.seed_records import NormalizedSeedRecord
from app.services.artifact_store import ArtifactStore

DEFAULT_ARTIFACT_PATH = Path("data/npm/normalized/npm-seed-records.ndjson.gz")
DEFAULT_CACHE_DIR = Path("evaluation/cache")
DEFAULT_CASES_PATH = Path("evaluation/npm_sanity_cases.json")
MODES: tuple[EmbeddingTextMode, ...] = ("package_description", "name_only")
EMBEDDING_BATCH_SIZE = 50
logger = logging.getLogger("customs.intelligence.evaluate_retrieval")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Compare retrieval results for package+description vs "
            "name-only embeddings."
        )
    )
    parser.add_argument("--artifact-path", default=str(DEFAULT_ARTIFACT_PATH))
    parser.add_argument("--cases-path", default=str(DEFAULT_CASES_PATH))
    parser.add_argument("--cache-dir", default=str(DEFAULT_CACHE_DIR))
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--output-json", default="")
    return parser


def load_cases(path: Path) -> list[dict[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("evaluation cases must be a JSON array")
    return [dict(item) for item in payload]


def load_records(path: Path) -> list[NormalizedSeedRecord]:
    store = ArtifactStore()
    return [
        NormalizedSeedRecord.model_validate(record)
        for record in store.read_records(path)
    ]


def corpus_cache_key(
    *,
    records: list[NormalizedSeedRecord],
    mode: EmbeddingTextMode,
    embedding_model: str,
) -> str:
    digest = hashlib.sha256()
    digest.update(embedding_model.encode("utf-8"))
    digest.update(b"\n")
    digest.update(mode.encode("utf-8"))
    for record in sorted(records, key=lambda item: (item.ecosystem, item.package)):
        search_eligible = is_search_eligible(record)
        digest.update(record.ecosystem.encode("utf-8"))
        digest.update(b"\n")
        digest.update(record.package.encode("utf-8"))
        digest.update(b"\n")
        digest.update(record.source_record_hash.encode("utf-8"))
        digest.update(b"\n")
        digest.update(str(search_eligible).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()[:16]


def cache_path_for_mode(
    *,
    cache_dir: Path,
    records: list[NormalizedSeedRecord],
    mode: EmbeddingTextMode,
    embedding_model: str,
) -> Path:
    key = corpus_cache_key(
        records=records,
        mode=mode,
        embedding_model=embedding_model,
    )
    model_name = embedding_model.replace("/", "_")
    return cache_dir / f"npm-{mode}-{model_name}-{key}.ndjson.gz"


def build_corpus_cache(
    *,
    cache_path: Path,
    records: list[NormalizedSeedRecord],
    mode: EmbeddingTextMode,
    embedding_client: OpenAIEmbeddingClient,
) -> list[EvaluatedNeighbor]:
    eligible_records = [record for record in records if is_search_eligible(record)]
    rows: list[dict[str, object]] = []
    evaluated_neighbors: list[EvaluatedNeighbor] = []

    logger.info(
        "building corpus embeddings: mode=%s eligible_records=%s cache=%s",
        mode,
        len(eligible_records),
        cache_path,
    )

    for start in range(0, len(eligible_records), EMBEDDING_BATCH_SIZE):
        batch = eligible_records[start : start + EMBEDDING_BATCH_SIZE]
        logger.info(
            "embedding corpus batch: mode=%s start=%s batch_size=%s total=%s",
            mode,
            start,
            len(batch),
            len(eligible_records),
        )
        texts = [
            build_embedding_text_for_mode(
                ecosystem=record.ecosystem,
                package=record.package,
                description=record.description,
                mode=mode,
            )
            for record in batch
        ]
        embeddings = embedding_client.embed_texts(texts)
        for record, embedding in zip(batch, embeddings, strict=True):
            row = {
                "ecosystem": record.ecosystem,
                "package": record.package,
                "description": record.description,
                "embedding": embedding,
                "source_rank": record.source_rank,
                "source_score_final": record.popularity_signal.get("score_final"),
                "search_eligible": True,
            }
            rows.append(row)
            evaluated_neighbors.append(
                EvaluatedNeighbor(
                    ecosystem=record.ecosystem,
                    package=record.package,
                    description=record.description,
                    embedding=[float(value) for value in embedding],
                    similarity_score=0.0,
                    source_rank=record.source_rank,
                    source_score_final=record.popularity_signal.get("score_final"),
                    search_eligible=True,
                )
            )

    ArtifactStore().write_records(cache_path, rows)
    logger.info(
        "wrote corpus cache: mode=%s records=%s cache=%s",
        mode,
        len(evaluated_neighbors),
        cache_path,
    )
    return evaluated_neighbors


def load_or_build_corpus(
    *,
    cache_dir: Path,
    records: list[NormalizedSeedRecord],
    mode: EmbeddingTextMode,
    embedding_model: str,
    embedding_client: OpenAIEmbeddingClient,
) -> list[EvaluatedNeighbor]:
    cache_path = cache_path_for_mode(
        cache_dir=cache_dir,
        records=records,
        mode=mode,
        embedding_model=embedding_model,
    )
    if cache_path.exists():
        logger.info(
            "loading cached corpus embeddings: mode=%s cache=%s",
            mode,
            cache_path,
        )
        cached_rows = ArtifactStore().read_records(cache_path)
        return [
            EvaluatedNeighbor(
                ecosystem=str(row["ecosystem"]),
                package=str(row["package"]),
                description=row.get("description"),
                embedding=[float(value) for value in row["embedding"]],
                similarity_score=0.0,
                source_rank=(
                    int(row["source_rank"])
                    if row.get("source_rank") is not None
                    else None
                ),
                source_score_final=(
                    float(row["source_score_final"])
                    if row.get("source_score_final") is not None
                    else None
                ),
                search_eligible=bool(row["search_eligible"]),
            )
            for row in cached_rows
        ]

    logger.info(
        "cache miss for corpus embeddings: mode=%s cache=%s",
        mode,
        cache_path,
    )
    return build_corpus_cache(
        cache_path=cache_path,
        records=records,
        mode=mode,
        embedding_client=embedding_client,
    )


def exact_match_for_case(
    *,
    case: dict[str, str],
    records: list[NormalizedSeedRecord],
) -> EvaluatedNeighbor | None:
    for record in records:
        if record.ecosystem == case["ecosystem"] and record.package == case["package"]:
            return EvaluatedNeighbor(
                ecosystem=record.ecosystem,
                package=record.package,
                description=record.description,
                embedding=[],
                similarity_score=1.0,
                source_rank=record.source_rank,
                source_score_final=record.popularity_signal.get("score_final"),
                search_eligible=is_search_eligible(record),
            )
    return None


def evaluate_case_for_mode(
    *,
    case: dict[str, str],
    records: list[NormalizedSeedRecord],
    corpus: list[EvaluatedNeighbor],
    mode: EmbeddingTextMode,
    embedding_client: OpenAIEmbeddingClient,
    query_cache: dict[tuple[EmbeddingTextMode, str], list[float]],
    top_k: int,
) -> RetrievalSelection:
    exact_match = exact_match_for_case(case=case, records=records)
    if exact_match is not None:
        logger.info(
            "exact match during retrieval evaluation: mode=%s package=%s",
            mode,
            case["package"],
        )
        return select_candidate(
            package=case["package"],
            exact_match=exact_match,
            query_embedding=None,
            corpus=corpus,
            top_k=top_k,
        )

    query_text = build_embedding_text_for_mode(
        ecosystem=case["ecosystem"],
        package=case["package"],
        description=case.get("description"),
        mode=mode,
    )
    cache_key = (mode, query_text)
    if cache_key not in query_cache:
        logger.info(
            "embedding evaluation query: mode=%s package=%s",
            mode,
            case["package"],
        )
        query_cache[cache_key] = embedding_client.embed_query(query_text)

    return select_candidate(
        package=case["package"],
        exact_match=None,
        query_embedding=query_cache[cache_key],
        corpus=[
            entry
            for entry in corpus
            if entry.ecosystem == case["ecosystem"] and entry.package != case["package"]
        ],
        top_k=top_k,
    )


def print_table(rows: list[dict[str, object]]) -> None:
    headers = [
        "label",
        "expected",
        "package",
        "package_description_match",
        "package_description_source",
        "package_description_semantic",
        "package_description_lexical",
        "name_only_match",
        "name_only_source",
        "name_only_semantic",
        "name_only_lexical",
    ]
    print("| " + " | ".join(headers) + " |")
    print("|" + "|".join("---" for _ in headers) + "|")
    for row in rows:
        values = []
        for header in headers:
            value = row.get(header)
            if isinstance(value, float):
                values.append(f"{value:.6f}")
            else:
                values.append(str(value))
        print("| " + " | ".join(values) + " |")


def main() -> int:
    args = build_parser().parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    settings = get_settings()
    artifact_path = Path(args.artifact_path)
    cases_path = Path(args.cases_path)
    cache_dir = Path(args.cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    logger.info("loading normalized corpus artifact: %s", artifact_path)
    records = load_records(artifact_path)
    logger.info("loaded normalized corpus records: %s", len(records))
    cases = load_cases(cases_path)
    logger.info("loaded evaluation cases: %s", len(cases))
    embedding_client = OpenAIEmbeddingClient.from_settings(settings)
    corpora = {
        mode: load_or_build_corpus(
            cache_dir=cache_dir,
            records=records,
            mode=mode,
            embedding_model=settings.embedding_model,
            embedding_client=embedding_client,
        )
        for mode in MODES
    }
    query_cache: dict[tuple[EmbeddingTextMode, str], list[float]] = {}

    rows: list[dict[str, object]] = []
    for index, case in enumerate(cases, start=1):
        logger.info(
            "evaluating case %s/%s: %s",
            index,
            len(cases),
            case["label"],
        )
        package_description = evaluate_case_for_mode(
            case=case,
            records=records,
            corpus=corpora["package_description"],
            mode="package_description",
            embedding_client=embedding_client,
            query_cache=query_cache,
            top_k=args.top_k,
        )
        name_only = evaluate_case_for_mode(
            case=case,
            records=records,
            corpus=corpora["name_only"],
            mode="name_only",
            embedding_client=embedding_client,
            query_cache=query_cache,
            top_k=args.top_k,
        )
        rows.append(
            {
                "label": case["label"],
                "expected": case.get("expected"),
                "package": case["package"],
                "package_description_match": package_description.nearest_match,
                "package_description_source": package_description.source,
                "package_description_semantic": package_description.similarity_score,
                "package_description_lexical": package_description.lexical_score,
                "name_only_match": name_only.nearest_match,
                "name_only_source": name_only.source,
                "name_only_semantic": name_only.similarity_score,
                "name_only_lexical": name_only.lexical_score,
            }
        )

    print_table(rows)
    if args.output_json:
        Path(args.output_json).write_text(json.dumps(rows, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
