# Intelligence Service

This directory holds the standalone intelligence service for the semantic
typosquat detector, plus the earlier data-validation spikes.

Current scope:

- prove we can source enough package metadata to seed a known-good corpus
- operate the standalone FastAPI intelligence service behind internal auth
- measure corpus quality before wiring the real vector and judge backends

Implemented so far:

- npm search sampling via `registry.npmjs.org/-/v1/search`
- PyPI metadata sampling via `pypi.org/simple`, package JSON, and `pypistats`
- FastAPI app scaffold with `/healthz`, `/check`, and `/seed`
- LangGraph-based check workflow
- stub-mode embeddings, neighbor search, and judge paths for local iteration
- Alembic scaffold and initial intelligence-schema migration
- `ruff` project configuration and config validation tests
- npm `collect -> normalize -> load` CLI scaffold
- repository and service-layer split for artifact IO and seed loading
- SQLAlchemy Core repository layer and validated `pydantic` pipeline models
- gzip-compressed `NDJSON` artifact helpers and pipeline tests
- separate embedding and metadata hash handling for corpus refreshes
- exact-package short-circuit before vector retrieval
- real OpenAI judge path with structured JSON output over top reranked candidates
- lexical candidate retrieval via Postgres package-name similarity (`pg_trgm`)
- layered runtime caches for request embeddings and judge results
- structured provider error responses for `/check`
- startup config logging with safe OpenAI key fingerprint diagnostics
- offline retrieval A/B tooling for `package+description` vs `name-only`
- request-body limiting ahead of FastAPI route parsing
- per-caller `/check` rate limiting and service-wide concurrency limiting
- API connector integration with graceful handling for throttled or busy intelligence responses

Current package layout:

- `app/main.py`
  - FastAPI entrypoint
- `app/core/`
  - config, DB assembly, schema metadata, error mapping
- `app/checks/`
  - embeddings, graph routing, judge logic
- `app/domain/`
  - lexical similarity and corpus policy
- `app/repositories/`
  - SQLAlchemy Core persistence adapters
- `app/services/`
  - pipeline/runtime helper services
- `app/evaluation/`
  - offline retrieval experiment helpers

This layout is intentional. The root `app` package should stay small and not become a
flat dump of unrelated modules.

Run the service locally:

```bash
cd services/intelligence
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt -r requirements-dev.txt
uvicorn app.main:app --reload --port 8001
```

Internal service auth:

- `/healthz` remains unauthenticated
- `/check` and `/seed` require a bearer token signed by the control plane
- the service verifies that token against the API JWKS exposed at
  `/.well-known/internal-service-jwks.json`
- the service uses `token_type` from the JWT as its internal role source
- capabilities are derived from that token type, not checked ad hoc per endpoint

Current token types:

- `api_connector`
  - grants `intelligence.check`
- `api_admin`
  - grants `intelligence.check`
  - grants `intelligence.seed`

`/seed` is intentionally global rather than tenant-scoped. It is a privileged
internal operation guarded by the `intelligence.seed` capability, which currently
only `api_admin` tokens receive.

Relevant env:

- `INTELLIGENCE_INTERNAL_JWKS_URL=http://localhost:3000/.well-known/internal-service-jwks.json`
- `INTELLIGENCE_INTERNAL_JWT_AUDIENCE=customs-intelligence-rpc`

## Configuration

The intelligence service currently reads its runtime configuration from
[`app/core/config.py`](/workspace/services/intelligence/app/core/config.py:1).

| Variable | Default | Description |
|---|---:|---|
| `ENVIRONMENT` | `development` | Environment label used for service behavior and startup logging. |
| `DATABASE_URL` | `""` | PostgreSQL connection string for the intelligence schema. Required for non-stub database-backed operation. |
| `INTELLIGENCE_DB_SCHEMA` | `intel` | PostgreSQL schema name used by the service tables and queries. |
| `OPENAI_API_KEY` | `""` | OpenAI API key used by the embedding and judge clients when stub mode is disabled. |
| `EMBEDDING_MODEL` | `openai/text-embedding-3-small` | Provider-qualified embedding model id for request and corpus embeddings. |
| `JUDGE_MODEL` | `openai/gpt-4o-mini` | Provider-qualified judge model id for semantic package classification. |
| `INTELLIGENCE_PORT` | `8001` | HTTP port the FastAPI app listens on. |
| `LOG_LEVEL` | `info` | Service log verbosity. |
| `INTELLIGENCE_REQUEST_BODY_LIMIT_BYTES` | `16384` | Maximum accepted HTTP request body size in bytes before the service returns `413 request_too_large`. |
| `INTELLIGENCE_CHECKS_PER_MINUTE` | `120` | Per-caller sliding-window limit for authenticated `/check` requests. |
| `INTELLIGENCE_CHECK_CONCURRENCY` | `8` | Maximum number of `/check` requests allowed to execute concurrently before the service returns `503 service_busy`. |
| `SIMILARITY_LOW_THRESHOLD` | `0.85` | Lower similarity threshold used by retrieval and verdict logic. |
| `SIMILARITY_HIGH_THRESHOLD` | `0.97` | Higher similarity threshold used by retrieval and verdict logic. |
| `SEARCH_TOP_K` | `5` | Number of top semantic candidates retrieved before reranking. |
| `INTELLIGENCE_STUB_MODE` | `false` | Enables stubbed local behavior for embeddings, judging, and other runtime services. |
| `INTELLIGENCE_INTERNAL_JWKS_URL` | `http://localhost:3000/.well-known/internal-service-jwks.json` | JWKS endpoint used to verify internal bearer tokens. |
| `INTELLIGENCE_INTERNAL_JWT_AUDIENCE` | `customs-intelligence-rpc` | Expected audience claim for internal bearer tokens. |

For local debug curls, mint a token from the API service and pass it as a bearer token.
Include `token_type` in the custom claims you mint.
`scripts/check_sanity.sh` accepts `INTELLIGENCE_BEARER_TOKEN` for this purpose.

Run the npm spike:

```bash
cd services/intelligence
python3 scripts/pull_npm_seed_sample.py --max-pages 4 --size 250
```

Run the PyPI spike:

```bash
cd services/intelligence
python3 scripts/pull_pypi_seed_sample.py
```

Run tests:

```bash
cd services/intelligence
. .venv/bin/activate
python -m pytest
```

Run lint:

```bash
cd services/intelligence
. .venv/bin/activate
ruff check .
```

Runtime guardrails:

- requests larger than `INTELLIGENCE_REQUEST_BODY_LIMIT_BYTES` are rejected with
  `413 request_too_large`
- authenticated `/check` callers are limited by
  `INTELLIGENCE_CHECKS_PER_MINUTE`
- when the service is already handling
  `INTELLIGENCE_CHECK_CONCURRENCY` concurrent `/check` requests, additional calls
  return `503 service_busy`

Run migrations:

```bash
cd services/intelligence
. .venv/bin/activate
alembic upgrade head
```

`DATABASE_URL` may be provided as either `postgresql://...` or
`postgresql+psycopg://...`; the service normalizes plain PostgreSQL URLs to the
SQLAlchemy `psycopg` dialect automatically.

Run npm seed pipeline:

```bash
cd services/intelligence
. .venv/bin/activate
python scripts/seed.py collect npm
python scripts/seed.py normalize npm
python scripts/seed.py load npm
```

The default npm collection query set is intentionally broader than a single package
topic. It mixes ecosystem keywords with package-family queries such as `react`,
`express`, `webpack`, `eslint`, `jest`, `lodash`, `axios`, and `commander` so the
initial corpus is not dominated by one slice of the registry.

One practical lesson from evaluation: a miss can simply mean the likely target package
is absent from the seeded corpus. Before changing embedding strategy based on a single
failed case, verify the expected target package actually exists in the normalized seed
artifact and loaded corpus.

Corpus retention and artifact retention are different concerns. Refresh runs are
additive plus selective updates for `package_embeddings`; falling out of the latest
seed snapshot does not imply removal from the searchable corpus. Artifact pruning is
only for local disk hygiene and debugging history.

The service also distinguishes between packages that are stored in the corpus and
packages that are eligible for candidate retrieval. Low-quality npm seed entries can
remain stored for traceability and later analysis while being excluded from nearest-
neighbor search via a `search_eligible` flag.

Run a small `/check` sanity suite:

```bash
cd services/intelligence
./scripts/check_sanity.sh
```

Override the target service URL with `INTELLIGENCE_BASE_URL` if needed.
If internal auth is enabled, also set `INTELLIGENCE_BEARER_TOKEN`.

Generate the OpenAPI artifact:

```bash
cd services/intelligence
. .venv/bin/activate
python scripts/export_openapi.py
```

This writes the current machine-readable API contract to:

- `docs/openapi.json`

The app keeps live OpenAPI and interactive docs disabled at runtime. Regenerate this
file whenever the request or response models change.

Run a repeatable `/check` evaluation report:

```bash
cd services/intelligence
. .venv/bin/activate
python scripts/evaluate_checks.py
```

This reads cases from `evaluation/npm_sanity_cases.json` and prints a table with
expected outcome, package, nearest match, semantic score, lexical score, and decision
fields from the live `/check` path.

Run an offline retrieval A/B comparison:

```bash
cd services/intelligence
. .venv/bin/activate
python scripts/experimental/evaluate_retrieval_modes.py
```

This compares the current `package+description` retrieval shape against `name-only`
retrieval using the normalized seed artifact and local cached corpus embeddings under
`evaluation/cache/`.

Render the LangGraph `/check` workflow:

```bash
cd services/intelligence
. .venv/bin/activate
python scripts/experimental/render_check_graph.py
```

This writes:

- `docs/diagrams/check_graph.native.mmd`
  - Mermaid emitted directly from the compiled LangGraph
- `docs/diagrams/check_graph.curated.mmd`
  - a hand-labeled Mermaid view of the important conditional branches

Use `--with-png` to also write `docs/diagrams/check_graph.native.png` if Mermaid PNG
rendering is available in your environment.

Current retrieval decision:

- keep `package+description` as the primary embedding text for live retrieval
- do not switch the live corpus to `name-only` embeddings based on the current
  evaluation set

Reason:

- the offline comparison showed `package+description` retrieval returning the intended
  canonical targets for typo cases such as `recat -> react`, `lodahs -> lodash`, and
  `axois -> axios`
- the `name-only` mode drifted to weaker candidates such as `catw`, `lodashsh`, and
  `axues`

This should not be revisited unless one of these changes materially:

- the evaluation fixture
- the embedding model
- the retrieval architecture

Current `/check` algorithm, in order:

1. exact package lookup against the stored corpus
2. request embedding generation or cache hit
3. semantic pgvector retrieval over `search_eligible=true`
4. lexical candidate retrieval over `search_eligible=true`
5. merged lexical/trust-aware reranking of the candidate sets
6. cached OpenAI judge decision lookup for the top reranked candidate set
7. OpenAI judge over the top reranked candidates for ambiguous typo-like cases on a
   cache miss

The lexical candidate path is local and does not use a second embedding model. It uses
package-name similarity in Postgres and then computes semantic similarity from the
existing stored embeddings for those rows.

Runtime caches are intentionally layered:

- `intel.check_query_embeddings` caches request embeddings
- `intel.check_judge_results` caches judge decisions for a specific request plus
  reranked candidate-set hash

That means repeated suspicious or ambiguous checks can now skip both request embedding
generation and the OpenAI judge call when the request and candidate set are unchanged.

To support lexical candidate retrieval efficiently, the service now manages `pg_trgm`
through the intelligence migration path and adds a trigram index over normalized package
names in `package_embeddings`.

Error handling:

- `/check` now returns structured JSON errors instead of raw FastAPI 500 pages when an
  upstream OpenAI call fails
- oversized request bodies are surfaced as:
  - `error.code = request_too_large`
- service-level `/check` throttling is surfaced as:
  - `error.code = rate_limited`
- service-level `/check` concurrency saturation is surfaced as:
  - `error.code = service_busy`
- provider authentication / permission failures are surfaced as:
  - `error.code = provider_auth_failed`
- generic internal failures are surfaced as:
  - `error.code = internal_error`

For non-stub `/check`, the OpenAI key must support both:

- embeddings for the request embedding path
- chat completions for the judge path

If you use a restricted key, missing model/request scope or chat-completions access
will now return a structured error response instead of an unhandled exception.

The service also logs a sanitized `startup_config` line at startup, including:

- effective schema
- stub mode
- model ids
- a safe OpenAI API key fingerprint

This is intentional. It lets operators confirm which key the process actually loaded
without logging the raw secret.

Refresh/update behavior is intentionally split:

- `source_record_hash` tracks embedding-driving content only
- `metadata_hash` tracks rank/score/eligibility metadata
- source hash changes trigger re-embedding
- metadata-only changes update trust and retrieval fields without regenerating vectors

Current schema note:

- `package_embeddings` is intentionally a wide row for now
- this is acceptable because one `(ecosystem, package)` row currently owns:
  - the live embedding representation
  - retrieval/trust metadata
  - refresh hashes
  - run provenance
- the hot path benefits from having those fields together for exact lookup, candidate
  retrieval, reranking, and trust evaluation
- this should only be revisited if the service needs multiple embedding
  representations per package, embedding history, or broader reuse of package identity
  independent of vector storage
- if the schema is split later, the first likely split should be a child table for
  multiple embedding representations rather than scattering current metadata into many
  small tables

API contract:

- see `docs/openapi.json` for the generated request and response schemas
- top-level `/check` fields are still intended for policy mapping:
  - `match_quality`: `strong | ambiguous | weak`
  - `recommended_action`: `block | review | allow`

Current status:

- the standalone service is in a solid v1 state for evaluation and integration work
- retrieval quality is now good enough to move forward
- latency on repeated suspicious checks is materially improved by the judge-result cache
- confidence is still model-driven rather than calibrated, so it should be treated as
  useful but not final risk scoring
- the API connector integration in `services/api` is live and now treats intelligence
  throttling/busy responses as temporary unavailability instead of a fatal connector
  failure

The `metadata` object keeps supporting evidence for debugging, tuning, and future
policy use without forcing callers to reason across many low-level fields in the main
response body.
