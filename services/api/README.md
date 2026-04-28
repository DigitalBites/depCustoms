# Customs API Service

Scope: `services/api`

This service is the control plane API for Customs. It serves the dashboard's REST API, exposes the proxy-facing ConnectRPC gateway, proxies browser auth traffic to GoTrue, and owns policy evaluation, tenant/project administration, package/security views, and event ingestion.

## What This Service Does

- serves authenticated REST APIs for tenants, projects, tokens, policies, rules, violations, packages, proxies, performance, and security views
- exposes the proxy-facing `customs.v1.GatewayService` ConnectRPC methods used by the proxy for live policy checks and usage recording
- proxies `/auth/v1/*` requests to GoTrue when `AUTH_PROXY_ENABLED=true`
- handles the internal GoTrue custom access token hook at `/internal/auth/token-hook`
- initializes package intelligence connectors at startup and uses them during policy/security evaluation
- writes structured logs and enforces shared request validation and access-control patterns

## Runtime Surfaces

### Public/Operator HTTP

- `GET /healthz`
  - readiness endpoint; returns `503` until the database is reachable

- `/auth/v1/*`
  - GoTrue passthrough mounted by the API when auth proxying is enabled

- `POST /internal/auth/token-hook`
  - GoTrue webhook that stamps tenant claims into issued JWTs
- `GET /internal/bootstrap/status`
  - public coarse bootstrap state for dashboard routing; does not expose detailed setup checks
- `GET /internal/bootstrap/status/detail`
  - operator-facing bootstrap diagnostics; requires `x-bootstrap-secret`
- `POST /internal/bootstrap/first-user`
  - one-time first-user bootstrap route; requires `x-bootstrap-secret` matching `BOOTSTRAP_FIRST_USER_SECRET`
- `GET /.well-known/internal-service-jwks.json`
  - public JWKS for API-issued internal service runtime JWT verification

### Authenticated REST API

Main route groups currently mounted by the API:

- `/v1/auth/*`
  - tenant preference updates for authenticated users
- `/v1/tenants/*`
  - tenant details, entitlements, invites, and membership management
- `/v1/projects/*`
  - project listing plus project-scoped policy, security, package, violation, and token flows
- `/v1/tokens/*`
  - project token management
- `/v1/events*`
  - event listing and SSE event streams
- `/v1/policies/*`
  - policy CRUD, project effective policies, and policy-scoped summaries
- `/v1/rules/*`
  - rule CRUD and policy rule listing
- `/v1/policy-assignments/*`
  - policy assignment management
- `/v1/policy-preview/*`
  - policy preview and evaluation support
- `/v1/policy-evaluations/*`
  - stored evaluation/result views
- `/v1/violations/*`
  - tenant/project violation listing, detail, and summaries
- `/v1/violation-suppressions/*`
  - suppression reads/writes
- `/v1/packages/*`
  - tenant/project package inventory and rebuild flows
- `/v1/security/*`
  - security summaries, findings, package views, and connector-driven sync flows
- `/v1/connectors*`
  - connector metadata and field discovery
- `/v1/field-catalog`, `/v1/operators`, `/v1/connectors/:key/fields`
  - policy-builder metadata
- `/v1/proxies/*`
  - proxy registration and deletion
- `/v1/performance`
  - operational metrics summary

### ConnectRPC Gateway

The Node server routes requests whose path starts with `/customs.v1.` to the generated Connect handler. The API currently serves:

- `customs.v1.GatewayService.Check`
- `customs.v1.GatewayService.RecordUsage`
- `customs.v1.GatewayService.RecordProxyStatus`

These methods are the proxy's policy decision and event-ingestion boundary.

## Authentication Model

- dashboard/browser requests use Supabase-issued JWTs and go through `authMiddleware`
- the API can proxy `/auth/v1/*` to GoTrue so the dashboard only needs one API origin in local/dev setups
- GoTrue calls `/internal/auth/token-hook` during token issuance; the API verifies the webhook signature and injects tenant membership claims
- proxy-to-API ConnectRPC requests authenticate with `x-proxy-id` and `x-proxy-secret`
- successful proxy bootstrap exchanges return short-lived API-issued internal service JWTs; API verification is backed by the internal JWKS document
- project tokens are validated during policy checks and usage ingestion; proxy credentials and project tokens are separate concerns

## Startup Behavior

On boot, the service:

1. reads and logs a sanitized config snapshot
2. builds the Hono app
3. initializes configured package intelligence connectors
4. starts the HTTP server
5. retries database connectivity in the background until `/healthz` can report ready

On shutdown, connector `shutdown()` hooks are called before the Node server closes.

## Development

### Install

```bash
npm install
```

### Run Locally

```bash
npm run dev
```

Default port: `3000`

### Build

```bash
npm run build
```

### Tests

```bash
npm test
npm run test:unit
npm run test:service-int
npm run test:route-validation
```

### Database

```bash
npm run db:push
npm run db:generate
npm run db:migrate
npm run seed
```

### Proto Codegen

Run from the monorepo root proto package:

```bash
cd /workspace/shared/proto
buf generate
```

This regenerates the ConnectRPC types used under `services/api/src/gen/`.

## Technical Debt

- Upgrade the API from Zod 3 to Zod 4 before expanding the REST OpenAPI rollout beyond the current bootstrap/token slice.
  The first OpenAPI export was implemented with `@hono/zod-openapi` on an older compatibility line because the service still depends on Zod 3. That worked for the initial slice, but broader contract coverage will be cleaner and lower-friction on the current Zod 4 / latest `@hono/zod-openapi` path.

## Environment Variables

The API reads all environment variables once at startup from `src/config.ts` and connector config modules.

### Core Runtime

| Variable       | Default       | Required | Purpose                                                   |
| -------------- | ------------- | -------- | --------------------------------------------------------- |
| `ENVIRONMENT`  | `development` | no       | Runtime environment label used in logs and error behavior |
| `LOG_LEVEL`    | `info`        | no       | Structured logger level                                   |
| `PORT`         | `3000`        | no       | HTTP listen port                                          |
| `DATABASE_URL` | empty         | yes      | Postgres connection string                                |

### Request/Ingress Limits

| Variable                       | Default                 | Required | Purpose                                         |
| ------------------------------ | ----------------------- | -------- | ----------------------------------------------- |
| `API_REQUEST_BODY_LIMIT_BYTES` | `1048576`               | no       | Max accepted HTTP request body size             |
| `API_RECORD_USAGE_MAX_EVENTS`  | `1000`                  | no       | Hard cap for one `RecordUsage` ConnectRPC batch |
| `API_CORS_ORIGIN`              | `http://localhost:3001` | no       | Comma-separated allowed browser origins         |

### Internal Service JWTs

| Variable                           | Default              | Required | Purpose                                                             |
| ---------------------------------- | -------------------- | -------- | ------------------------------------------------------------------- |
| `PROXY_JWT_TTL_SECONDS`            | `900`                | no       | TTL for API-issued internal runtime JWTs used by proxy and services |
| `INTERNAL_SERVICE_JWT_PRIVATE_JWK` | empty                | yes      | Private JWK used by the API to sign internal service runtime JWTs   |
| `INTERNAL_SERVICE_JWT_KEY_ID`      | `internal-service-1` | no       | `kid` published in the internal JWKS and embedded in signed tokens  |
### Auth / GoTrue

| Variable                    | Default | Required                                    | Purpose                                                                |
| --------------------------- | ------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| `AUTH_URL`                  | empty   | yes in practice                             | URL the API uses for auth-related self references and local auth flows |
| `BOOTSTRAP_FIRST_USER_SECRET` | empty | yes                                         | Shared secret required by `POST /internal/bootstrap/first-user` via the `x-bootstrap-secret` header |
| `AUTH_PROXY_ENABLED`        | `true`  | no                                          | Enables `/auth/v1/*` GoTrue passthrough                                |
| `GOTRUE_URL`                | empty   | yes when auth proxy or admin flows are used | Base URL for the GoTrue service                                        |
| `GOTRUE_ANON_KEY`           | empty   | yes for browser auth flows                  | GoTrue anon key                                                        |
| `GOTRUE_SERVICE_ROLE_KEY`   | empty   | yes for admin flows                         | Used by auth admin operations                                          |
| `GOTRUE_HOOK_SECRET`        | empty   | yes                                         | Shared secret for `/internal/auth/token-hook` verification             |
| `GOTRUE_REQUEST_TIMEOUT_MS` | `5000`  | no                                          | Timeout for proxied GoTrue requests                                    |

### Internal Admin

| Variable                | Default | Required | Purpose                                                                                                                   |
| ----------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `INTERNAL_ADMIN_SECRET` | unset   | no       | Reserved for internal operator routes documented in `.env.example`; no mounted `/internal/v1/*` handler currently uses it |

### Package Intelligence Connectors

Current built-in connectors: OSV, contributor risk, and the optional intelligence connector.

| Variable                              | Default               | Required | Purpose                                                   |
| ------------------------------------- | --------------------- | -------- | --------------------------------------------------------- |
| `CONNECTOR_OSV_ENABLED`               | `true`                | no       | Enables/disables the OSV connector                        |
| `OSV_API_URL`                         | `https://api.osv.dev` | no       | Override OSV base URL                                     |
| `CONNECTOR_OSV_CACHE_TTL_SECONDS`     | `3600`                | no       | Freshness window for cached OSV results                   |
| `CONNECTOR_OSV_RESPONSE_TIMEOUT_MS`   | `2000`                | no       | Per-request response deadline before fail-closed behavior |
| `CONNECTOR_OSV_BACKGROUND_TIMEOUT_MS` | `30000`               | no       | Background HTTP timeout for the longer-running OSV fetch  |
| `CONNECTOR_CONTRIBUTOR_ENABLED`       | `true`                | no       | Enables/disables the contributor risk connector           |
| `CONNECTOR_CONTRIBUTOR_CACHE_TTL_SECONDS` | `3600`            | no       | Freshness window for cached contributor results           |
| `CONNECTOR_CONTRIBUTOR_RESPONSE_TIMEOUT_MS` | `3000`         | no       | Per-request response deadline for contributor lookup      |
| `CONNECTOR_CONTRIBUTOR_CACHE_TTL_OVERRIDE_SECONDS` | unset   | no       | Optional development TTL override for contributor caches  |
| `CONNECTOR_INTELLIGENCE_ENABLED`      | `false`               | no       | Enables/disables the intelligence connector               |
| `INTELLIGENCE_API_URL`                | `http://intelligence:8000` | no  | Base URL for the internal intelligence service            |
| `CONNECTOR_INTELLIGENCE_CACHE_TTL_SECONDS` | `3600`          | no       | Freshness window for cached intelligence results          |
| `CONNECTOR_INTELLIGENCE_RESPONSE_TIMEOUT_MS` | `1500`       | no       | Per-request response deadline for intelligence lookups    |
| `CONNECTOR_INTELLIGENCE_BACKGROUND_TIMEOUT_MS` | `10000`    | no       | Background HTTP timeout for the intelligence request      |

## Important Operational Notes

- `GET /healthz` returns `503` until the API can successfully query the database
- `GET /internal/bootstrap/status/detail` and `POST /internal/bootstrap/first-user` are intentionally protected by `BOOTSTRAP_FIRST_USER_SECRET`; generate a strong random value and keep it out of logs and client-side config
- request-body limits are enforced at the app boundary for both JSON and raw-text bodies
- CORS allowlists are explicit; the API returns the first configured origin when the incoming origin is not allowed
- ConnectRPC requests copy `X-Forwarded-For` into `x-proxy-remote-addr` before handing off to the gateway handler
- connector startup failures are logged; the process stays up unless startup itself throws

## Code Organization

Current package ownership:

- `src/app/`
  - app bootstrap, server assembly, and startup wiring
- `src/auth/`
  - auth claims, GoTrue client/proxy helpers, and auth admin service
- `src/http/`
  - shared response helpers, validation helpers, and access guards
- `src/connect/`
  - proxy-facing ConnectRPC gateway handlers
- `src/connectors/`
  - connector interfaces, runtime, registry, cache, and OSV implementation
- `src/db/`
  - database wiring and schema
- `src/events/`
  - shared event enrichment helpers
- `src/features/*/`
  - feature-owned route logic and query helpers
- `src/middleware/`
  - auth and RBAC middleware
- `src/policy/`
  - policy resolution and evaluation
- `src/routes/`
  - thin HTTP composition boundaries
- `src/sse/`
  - event subscription and fan-out infrastructure
- `src/test/`
  - unit, integration, and service-integration tests

Boundary rules:

- keep `src/routes/` thin
- keep auth-specific helpers in `src/auth/`
- keep shared HTTP validation/response/guard helpers in `src/http/`
- keep ConnectRPC-specific logic in `src/connect/`
- do not add new modules to legacy `src/lib/`

For agent workflow and service-local guardrails, see [AGENTS.md](/workspace/services/api/AGENTS.md).
