# Customs Intelligence Service

Scope: `services/intelligence`

## Overview

The intelligence service is the internal semantic-typosquat and package-similarity
service used by the API’s intelligence connector. It exposes a small internal
HTTP surface for `/check` and `/seed`, manages its own corpus and migrations,
and runs in either live OpenAI-backed mode (production) or a deterministic
stub mode (development plumbing only — see
[Stub Mode vs. Live Mode](#stub-mode-vs-live-mode) below).

## Quick Start

For the overall OSS stack and bundled deployment, start at the
[root README](../../README.md).

For local intelligence-only development:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt -r requirements-dev.txt
```

The service depends on:

- PostgreSQL for corpus-backed behavior
- the API JWKS for internal bearer-token verification
- `OPENAI_API_KEY` in live mode

### First-Run Checklist

Before starting the service, make sure these inputs are set:

- `DATABASE_URL`
- `OPENAI_API_KEY` for live mode
- `INTELLIGENCE_INTERNAL_JWKS_URL` if you are not using the default API URL
- `INTERNAL_SERVICE_JWT_PRIVATE_JWK` if you want `scripts/evaluate_checks.py`
  to auto-mint its own bearer token

For the evaluation helper, the private JWK must match the running API's JWKS.
If it does not, the helper will mint a token successfully but `/check` calls
will fail with `401 Invalid bearer token`.

### Start The Service

```bash
. .venv/bin/activate
uvicorn app.main:app --reload --port 8001
```

In live mode, startup now:

1. runs migrations by default
2. verifies DB/schema readiness
3. prewarms embeddings and judge services
4. only then reports ready

### Validate Service Readiness

In a second shell:

```bash
. .venv/bin/activate
curl -i http://localhost:8001/healthz
```

Expected healthy result:

```text
HTTP/1.1 200 OK
```

If startup is still in progress or the schema is not ready, `/healthz` returns
`503`.

### First Real Bootstrap

If you are starting from an empty intelligence schema or a fresh corpus, the
shortest useful path is:

```bash
. .venv/bin/activate
python scripts/seed.py refresh npm --preset bootstrap
python scripts/evaluate_checks.py --base-url http://localhost:8001
```

`refresh` is the end-to-end seed pipeline. It runs:

1. `collect`
2. `normalize`
3. `load`

`--preset bootstrap` is intended for a real first-run corpus. `--preset sample`
is only a small smoke-test corpus and is too small for meaningful similarity
evaluation.

`bootstrap` includes the default high-signal npm queries plus `commander`.
Supplying `--query` overrides the preset query set, which is useful for adding
specific packages to an already-seeded corpus without rerunning the full
bootstrap query set.

Treat `scripts/evaluate_checks.py` as the setup validation check. A healthy
first run should show:

- obvious typos such as `recat`, `lodahs`, `reactt` flagged as suspicious
- benign exact matches such as `react`, `lodash`, `preact` allowed
- non-empty latency and similarity columns in the output table

### Manual Seed Flow

If you want to inspect the intermediate artifacts instead of running the full
pipeline, use the three explicit steps:

```bash
. .venv/bin/activate
python scripts/seed.py collect npm --preset bootstrap
python scripts/seed.py normalize npm
python scripts/seed.py load npm
```

Use `collect` when you want raw npm search pages only. Use `refresh` when you
want the full `collect -> normalize -> load` flow in one command.

### Additive Seed Update

The seed pipeline is additive. If you already bootstrapped the corpus and only
want to add coverage for a specific package, run a targeted refresh with
`--query`:

```bash
. .venv/bin/activate
python scripts/seed.py refresh npm --preset sample --query commander
```

That command only collects the `commander` query set, normalizes it, and
upserts it into the existing corpus.

### Evaluation Helper

`scripts/evaluate_checks.py` requires `--base-url`. For auth it will:

- use `INTELLIGENCE_BEARER_TOKEN` if already set
- otherwise auto-mint a test token from `INTERNAL_SERVICE_JWT_PRIVATE_JWK`

Minimal example:

```bash
. .venv/bin/activate
export INTERNAL_SERVICE_JWT_PRIVATE_JWK='{"kty":"EC","kid":"...","crv":"P-256","x":"...","y":"...","d":"...","alg":"ES256"}'
python scripts/evaluate_checks.py --base-url http://localhost:8001
```

If you already have a bearer token, you can skip auto-minting:

```bash
. .venv/bin/activate
export INTELLIGENCE_BEARER_TOKEN='<token>'
python scripts/evaluate_checks.py --base-url http://localhost:8001
```

## Tech Stack

- Python
- FastAPI
- SQLAlchemy
- LangGraph
- pytest
- Ruff

## What This Service Does

- exposes internal `/check` and `/seed` HTTP endpoints behind internal bearer
  auth
- runs the semantic package-check flow used by the API intelligence connector
- supports stub-mode embeddings, neighbor search, and judge paths for local
  iteration (stub verdicts are synthetic — see Stub Mode vs. Live Mode)
- manages corpus loading, retrieval helpers, and package-seed pipelines
- maintains its own Alembic migrations and intelligence schema
- exports an offline OpenAPI artifact for the current API contract
- enforces request-size limits, per-caller `/check` rate limits, and service
  concurrency limits

## Runtime Surfaces

- `GET /healthz`
  - unauthenticated readiness-style health endpoint
  - returns `503` until startup completes or when the database/schema is unavailable
- `POST /check`
  - internal authenticated package intelligence check path
- `POST /seed`
  - internal authenticated seed-ingestion path

The service keeps live OpenAPI and interactive docs disabled at runtime. The
machine-readable API contract is exported offline to `docs/openapi.json`.

### `/check` Flow

```mermaid
graph TD
    start([start]) --> exact_match_lookup[exact_match_lookup]

    exact_match_lookup -->|exact package exists in corpus| exact_pass[exact_pass]
    exact_match_lookup -->|no exact package| embed_query[embed_query]

    embed_query --> candidate_search[candidate_search<br/>semantic + lexical<br/>+ rerank]

    candidate_search -->|no candidates| pass_node[pass]
    candidate_search -->|top candidate equals request| pass_node
    candidate_search -->|high trust + lexical >= 0.8| flag_without_judge[flag_without_judge]
    candidate_search -->|typo-like but needs adjudication| llm_judge[llm_judge]
    candidate_search -->|non-typo or weak signal| pass_node

    exact_pass --> done([end])
    pass_node --> done
    flag_without_judge --> done
    llm_judge --> done
```

For the maintained Mermaid source, see
[`docs/diagrams/check_graph.curated.mmd`](docs/diagrams/check_graph.curated.mmd).

## Authentication Model

The intelligence service is an internal-only service. It does not mint its
own tokens — it consumes tokens minted by the API control plane and
verifies them against the API's JWKS document.

- `/healthz` is unauthenticated
- `/check` and `/seed` require a bearer token signed by the API control
  plane, audience `customs-intelligence-rpc`
- tokens are verified against
  `INTELLIGENCE_INTERNAL_JWKS_URL` (defaults to the API's
  `/.well-known/internal-service-jwks.json`)
- the service derives its internal role from the JWT's `token_type` claim
  and resolves capabilities through `app/core/capabilities.py` —
  endpoints check capabilities, not token types directly

Token types and their capabilities:

| Token type      | Capabilities                              | Issued to                                                             |
| --------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| `api_connector` | `intelligence.check`                      | The API's intelligence connector during normal policy evaluation      |
| `api_admin`     | `intelligence.check`, `intelligence.seed` | Privileged operator workflows that need to seed or rebuild the corpus |

`/seed` is intentionally global rather than tenant-scoped — corpus
seeding is a platform-wide operation guarded by the `intelligence.seed`
capability, which only `api_admin` tokens receive.

For the canonical token minting flow, JWKS distribution, and the broader
capability model the API uses to issue these tokens, see the
[API service README](../../services/api/README.md#authentication--authorization-model).

## Development

### Install

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt -r requirements-dev.txt
```

### Run Locally

```bash
. .venv/bin/activate
uvicorn app.main:app --reload --port 8001
```

Default port: `8001`

### Build

The service is typically run directly with `uvicorn` in development or built
through its Dockerfile in containerized environments.

### Tests

```bash
. .venv/bin/activate
python -m pytest
```

Some tests require `DATABASE_URL` for integration coverage. Live OpenAI-backed
behavior is not required when `INTELLIGENCE_STUB_MODE=true`.

### Database

```bash
. .venv/bin/activate
alembic upgrade head
```

In live mode, the service now also runs `alembic upgrade head` during startup by
default. Set `INTELLIGENCE_AUTO_MIGRATE_ON_STARTUP=false` if you want migrations
to remain a separate operational step.

### OpenAPI Export

```bash
. .venv/bin/activate
python scripts/export_openapi.py
```

This writes the current machine-readable API contract to `docs/openapi.json`.

## Stub Mode vs. Live Mode

The service has two operating modes, controlled by `INTELLIGENCE_STUB_MODE`.
Use the right one for the right purpose — they are not interchangeable.

### Live mode (`INTELLIGENCE_STUB_MODE=false`, the default)

This is the only mode that produces real verdicts. It calls OpenAI for
embeddings (`EMBEDDING_MODEL`, default `text-embedding-3-small`) and for
the judge step (`JUDGE_MODEL`, default `gpt-4o-mini`). Both are
inexpensive — at current pricing, embedding and judge calls for normal
package-check traffic are essentially noise on the bill (a few dollars
of credit covers a lot of traffic). An `OPENAI_API_KEY` is required.

**Live verdicts are still being tuned.** The service is operational, but
verdict quality is a function of (1) the curated corpus the retrieval
step searches against, (2) the similarity thresholds in
`SIMILARITY_LOW_THRESHOLD` / `SIMILARITY_HIGH_THRESHOLD`, and (3) the
judge prompt. All three are actively being refined. Expect false
positives and false negatives, especially on long-tail packages whose
neighbors are sparsely represented in the corpus. Operators should
treat intelligence verdicts as one signal in a layered policy — useful,
not authoritative — and keep CVE and contributor rules in place
alongside it. Scaling the corpus to cover the full long tail of npm is
where the bulk of the remaining work lives.

### Stub mode (`INTELLIGENCE_STUB_MODE=true`)

This mode swaps in deterministic stubs for embeddings and judge calls
so the service boots and the `/check` graph runs without an API key.
**Verdicts produced in stub mode are synthetic and have no correlation
with real package similarity.** Use it for:

- bringing up the stack end to end during development
- exercising the policy path and connector wiring in tests
- offline plumbing checks where reproducibility matters

Do **not** rely on stub-mode verdicts for any real policy decision. A
deployment that needs to be air-gapped should disable the intelligence
connector entirely (`CONNECTOR_INTELLIGENCE_ENABLED=false` on the API)
rather than run it against stub output.

## Configuration

The intelligence service reads its runtime configuration from
`app/core/config.py`.

| Variable                                | Default                                                        | Description                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ENVIRONMENT`                           | `development`                                                  | Environment label used for service behavior and startup logging.                                                   |
| `DATABASE_URL`                          | empty                                                          | PostgreSQL connection string for the intelligence schema. Required for non-stub database-backed operation.         |
| `INTELLIGENCE_DB_SCHEMA`                | `intel`                                                        | PostgreSQL schema name used by the service tables and queries.                                                     |
| `INTELLIGENCE_AUTO_MIGRATE_ON_STARTUP`  | `true`                                                         | When enabled, runs `alembic upgrade head` during service startup before accepting traffic.                         |
| `OPENAI_API_KEY`                        | empty                                                          | OpenAI API key used by the embedding and judge clients when stub mode is disabled.                                 |
| `EMBEDDING_MODEL`                       | `openai/text-embedding-3-small`                                | Provider-qualified embedding model identifier for request and corpus embeddings.                                   |
| `JUDGE_MODEL`                           | `openai/gpt-4o-mini`                                           | Provider-qualified judge model identifier for semantic package classification.                                     |
| `INTELLIGENCE_PORT`                     | `8001`                                                         | HTTP port the FastAPI app listens on.                                                                              |
| `LOG_LEVEL`                             | `info`                                                         | Service log verbosity.                                                                                             |
| `INTELLIGENCE_REQUEST_BODY_LIMIT_BYTES` | `16384`                                                        | Maximum accepted HTTP request body size before the service returns `413 request_too_large`.                        |
| `INTELLIGENCE_CHECKS_PER_MINUTE`        | `120`                                                          | Per-caller sliding-window limit for authenticated `/check` requests.                                               |
| `INTELLIGENCE_CHECK_CONCURRENCY`        | `8`                                                            | Maximum number of `/check` requests allowed to execute concurrently before the service returns `503 service_busy`. |
| `SIMILARITY_LOW_THRESHOLD`              | `0.85`                                                         | Lower similarity threshold used by retrieval and verdict logic.                                                    |
| `SIMILARITY_HIGH_THRESHOLD`             | `0.97`                                                         | Higher similarity threshold used by retrieval and verdict logic.                                                   |
| `JUDGE_LEXICAL_BACKSTOP_THRESHOLD`      | `0.6`                                                          | Lexical-similarity backstop that routes medium/high-trust candidates to the judge before an early pass.            |
| `SEARCH_TOP_K`                          | `5`                                                            | Number of top semantic candidates retrieved before reranking.                                                      |
| `INTELLIGENCE_STUB_MODE`                | `false`                                                        | Enables stubbed local behavior for embeddings, judging, and other runtime services.                                |
| `INTELLIGENCE_INTERNAL_JWKS_URL`        | `http://localhost:3000/.well-known/internal-service-jwks.json` | JWKS endpoint used to verify internal bearer tokens.                                                               |
| `INTELLIGENCE_INTERNAL_JWT_AUDIENCE`    | `customs-intelligence-rpc`                                     | Expected audience claim for internal bearer tokens.                                                                |

## Important Operational Notes

- `DATABASE_URL` may be provided as either `postgresql://...` or
  `postgresql+psycopg://...`; the service normalizes plain PostgreSQL URLs to
  the SQLAlchemy `psycopg` dialect automatically
- `/healthz` is a readiness check, not just process liveness; it returns `503`
  until startup finishes and whenever the configured intelligence schema is not usable
- requests larger than `INTELLIGENCE_REQUEST_BODY_LIMIT_BYTES` are rejected
  with `413 request_too_large`
- authenticated `/check` callers are limited by
  `INTELLIGENCE_CHECKS_PER_MINUTE`
- when the service is already handling
  `INTELLIGENCE_CHECK_CONCURRENCY` concurrent `/check` requests, additional
  calls return `503 service_busy`
- stub mode starts without OpenAI-backed embeddings or judge calls
- the API intelligence connector treats service throttling and busy responses as
  temporary unavailability rather than crashing the policy path

## Code Organization

- `app/main.py`
  - FastAPI entrypoint
- `app/core/`
  - config, DB assembly, schema metadata, auth, limits, and error mapping
- `app/checks/`
  - embeddings, graph routing, and judge logic
- `app/domain/`
  - lexical similarity and corpus policy
- `app/repositories/`
  - SQLAlchemy Core persistence adapters
- `app/services/`
  - pipeline and runtime helper services
- `app/evaluation/`
  - offline retrieval experiment helpers
- `sources/`
  - npm collection and normalization helpers
- `scripts/`
  - OpenAPI export, seed pipeline, evaluation, and sanity tooling
- `migrations/`
  - Alembic migrations for the intelligence schema

## Further Reading

- [Root README](../../README.md)
- [OSS Architecture](../../docs/architecture.md)
- [OpenAPI export](docs/openapi.json)
- [Check graph diagrams](docs/diagrams/check_graph.curated.mmd)
- [AGENTS.md](AGENTS.md)
