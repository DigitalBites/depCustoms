# Customs API Service

Scope: `services/api`

## Overview

The API service is the Customs control plane. It serves the dashboard's REST
API, exposes the proxy-facing ConnectRPC gateway, proxies browser auth traffic
to GoTrue, owns policy evaluation and persistence, and serves MCP bootstrap and
transport endpoints for agent clients.

## Quick Start

For the overall OSS stack and bundled deployment, start at the
[root README](../../README.md).

For local API-only development:

```bash
npm install
npm run dev
```

If you are working on proxy/API contract changes, regenerate protobuf types
from `shared/proto` before building.

## Tech Stack

- TypeScript / Node.js
- Hono
- Drizzle ORM
- ConnectRPC
- Vitest
- ESLint

## What This Service Does

- serves authenticated REST APIs for tenants, projects, tokens, policies,
  rules, violations, packages, proxies, performance, and security views
- exposes the proxy-facing `customs.v1.GatewayService` ConnectRPC methods used
  by the proxy for live policy checks and usage recording
- proxies `/auth/v1/*` requests to GoTrue when `AUTH_PROXY_ENABLED=true`
- handles the internal GoTrue custom access token hook at
  `/internal/auth/token-hook`
- serves MCP bootstrap and transport endpoints for agent clients
- initializes package intelligence connectors at startup and uses them during
  policy and security evaluation
- writes structured logs and enforces shared request validation and
  access-control patterns

## Runtime Surfaces

### Public and Operator HTTP

- `GET /healthz`
  - readiness endpoint; returns `503` until the database is reachable
- `/auth/v1/*`
  - GoTrue passthrough mounted by the API when auth proxying is enabled
- `POST /internal/auth/token-hook`
  - GoTrue webhook that stamps tenant claims into issued JWTs
- `GET /internal/bootstrap/status`
  - public coarse bootstrap state for dashboard routing
- `GET /internal/bootstrap/status/detail`
  - protected bootstrap diagnostics; requires `x-bootstrap-secret`
- `POST /internal/bootstrap/first-user`
  - one-time first-user bootstrap route; requires `x-bootstrap-secret`
- `GET /.well-known/internal-service-jwks.json`
  - JWKS for API-issued internal service runtime JWT verification
- `GET /.well-known/oauth-protected-resource/mcp`
- `GET /.well-known/oauth-authorization-server/mcp`
- `GET /.well-known/openid-configuration/mcp`
- `GET /mcp/.well-known/openid-configuration`
  - MCP and OAuth discovery metadata associated with the MCP transport

### Authenticated REST API

Main route groups currently mounted by the API:

- `/v1/auth/*`
- `/v1/tenants/*`
- `/v1/projects/*`
- `/v1/tokens/*`
- `/v1/events*`
- `/v1/policies/*`
- `/v1/rules/*`
- `/v1/policy-assignments/*`
- `/v1/policy-preview/*`
- `/v1/policy-evaluations/*`
- `/v1/violations/*`
- `/v1/violation-suppressions/*`
- `/v1/packages/*`
- `/v1/security/*`
- `/v1/connectors*`
- `/v1/field-catalog`
- `/v1/operators`
- `/v1/proxies/*`
- `/v1/performance`
- `/v1/mcp/*`

### MCP Transport

- `GET /api/mcp`
  - opens the MCP transport stream for an authenticated agent client
- `POST /api/mcp`
  - handles MCP JSON-RPC requests for an authenticated agent client

### ConnectRPC Gateway

The API serves these proxy-facing ConnectRPC methods:

- `customs.v1.GatewayService.Check`
- `customs.v1.GatewayService.RecordUsage`
- `customs.v1.GatewayService.RecordProxyStatus`

An offline OpenAPI export is available at `docs/openapi.json`. Current
coverage is intentionally partial and reflects the route groups already
converted to the OpenAPI-aware registration pattern.

## Authentication & Authorization Model

The API is the canonical authority for identity, role assignment, and
capability evaluation across the platform. Other services delegate to it.

### Identity sources

The control plane recognizes four distinct identities, each with its own
credential lifecycle:

| Identity | Used by | Credential | Verified via |
| --- | --- | --- | --- |
| **Human user** | Dashboard / browser | Supabase JWT (OAuth, magic link, password) | `authMiddleware` against GoTrue JWKS |
| **Project token** | npm / pip clients via the proxy | Bearer token (`cxp_…`, hashed in DB) | Lookup + SHA-256 compare during policy checks |
| **Proxy** | Customs proxy → control plane | Long-lived registration secret + short-lived runtime JWT | `x-proxy-id` + `x-proxy-secret` for bootstrap; JWKS-verified JWT for ongoing RPC |
| **Internal service** | Intelligence service, future workers | Short-lived runtime JWT minted by the API | Per-audience JWKS verification |

Project tokens and proxy credentials are deliberately separate concerns —
revoking one does not affect the other.

### Tenant roles and capabilities

RBAC is defined in `src/middleware/rbac.ts` as the canonical source of
truth. The model has five tenant-scoped roles and ~47 namespaced
capabilities. Capabilities are evaluated through
`canPerform(role, capability, context)`, where `context` provides
relationship-aware checks like `hasProjectAccess` and `ownsToken` (so
"member can rotate own token" works without a duplicate capability).

Roles, ordered from broadest to narrowest:

| Role | Scope | Notes |
| --- | --- | --- |
| `owner` | Full tenant | Holds every capability; the only role that can mint password-only members and operate tenant-wide MCP |
| `admin` | Full tenant | Same surface as `owner` minus a small set of bootstrap-only capabilities |
| `demo` | Read-mostly tenant | Broad read access for sales and demo environments; intentionally non-mutating by default |
| `member` | Project-scoped | Manages their own projects, can create projects and invite member/guest |
| `guest` | Project-scoped | Read-only on assigned projects; cannot create projects or invite |

Capabilities are namespaced by feature area:

```
overview.read        projects.{read,create,delete}
events.{read_tenant,read_project}    performance.read
policy.{read_tenant,read_project,write_tenant,write_project}
rules.{read,write}   policy_assignments.{read,write}    policy_preview.read
connectors.{read,write}    security.{read_tenant,read_project,write}
packages.{read_tenant,read_project,rebuild}
tokens.{read_all,read_own,create,revoke_any,revoke_own,rotate_any,rotate_own}
members.{read,invite,invite_admin,invite_unscoped,write_roles,
         create_password_user,reset_password}
settings.{read,write}    proxies.{read,write}
mcp.{read,connect,use_project,use_tenant}
violations.{read_tenant,read_project,write}
```

Adding a route should always go through a capability check rather than a
role check directly — capabilities are the durable contract; role-to-
capability mappings are the policy on top.

### Internal service JWT minting

Service-to-service traffic does not share a god-secret. The API mints
short-lived JWTs (default `PROXY_JWT_TTL_SECONDS=900`) signed with the
private JWK in `INTERNAL_SERVICE_JWT_PRIVATE_JWK`. Every consumer
verifies tokens against the public JWKS at:

```
GET /.well-known/internal-service-jwks.json
```

Tokens are scoped per consumer by audience:

| Audience | Consumer | Capabilities |
| --- | --- | --- |
| `customs-proxy-rpc` | Customs proxy | Tenant-bound proxy operations |
| `customs-intelligence-rpc` | Intelligence service callers | `intelligence.check`, optionally `intelligence.seed` |

The intelligence service maintains its own internal capability model
(`api_connector` and `api_admin` token types) keyed off the JWT's
`token_type` claim — see the
[intelligence service README](../intelligence/README.md#authentication-model)
for the consumer-side detail.

### Browser auth flow

- the API can proxy `/auth/v1/*` to GoTrue so the dashboard only needs
  one API origin in local and bundled deployment modes
- GoTrue calls `/internal/auth/token-hook` during token issuance; the
  API verifies the webhook signature with `GOTRUE_HOOK_SECRET` and
  stamps tenant membership claims into the issued JWT so RBAC can run
  without an extra database round-trip per request

### Proxy auth flow

A proxy registered through the dashboard receives a registration secret
(`cxp_…`) that is stored hashed (SHA-256) in the `proxies` table. On
startup it presents `x-proxy-id` + `x-proxy-secret`, the API verifies
the hash, and the proxy receives a short-lived JWT bound to its
`proxy_id` and `tenant_id`. All ongoing RPCs use the JWT, not the
secret. The proxy refreshes the runtime token on a schedule and
`/healthz` reflects refresh health.

### MCP auth

MCP transport requests authenticate with bearer tokens resolved through
the MCP auth service. OAuth discovery metadata is published under the
`/mcp`-scoped `.well-known` routes so standards-compliant agent
clients can negotiate without out-of-band configuration.

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

Some test suites require database and auth dependencies to be available.

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
cd ../../shared/proto
buf generate
```

This regenerates the ConnectRPC types used under `services/api/src/gen/`.

## Configuration

The API reads all environment variables once at startup from `src/config.ts`
and the connector config modules.

| Variable | Default | Description |
| --- | --- | --- |
| `ENVIRONMENT` | `development` | Runtime environment label used in logs and error behavior. |
| `LOG_LEVEL` | `info` | Structured logger level. |
| `PORT` | `3000` | HTTP listen port. |
| `DATABASE_URL` | empty | Postgres connection string. |
| `BOOTSTRAP_MODE` | `bundled` | Controls whether bundled first-run setup behavior is assumed by bootstrap status helpers. |
| `BOOTSTRAP_FIRST_USER_SECRET` | empty | Shared secret required by `POST /internal/bootstrap/first-user` and `GET /internal/bootstrap/status/detail` via the `x-bootstrap-secret` header. |
| `BOOTSTRAP_SETUP_FIRST_TENANT` | `true` | Enables bundled first-tenant bootstrap expectations in setup status. |
| `BOOTSTRAP_SETUP_FIRST_PROXY` | `true` | Enables bundled first-proxy bootstrap expectations in setup status. |
| `BOOTSTRAP_SETUP_DEFAULT_POLICIES` | `true` | Enables bundled default-policy bootstrap expectations in setup status. |
| `BOOTSTRAP_PROXY_ID` | empty | Optional bundled proxy ID used by bootstrap status checks to determine whether the expected proxy is already registered. |
| `API_REQUEST_BODY_LIMIT_BYTES` | `1048576` | Maximum accepted HTTP request body size. |
| `API_RECORD_USAGE_MAX_EVENTS` | `1000` | Hard cap for one `RecordUsage` ConnectRPC batch. |
| `API_CORS_ORIGIN` | `http://localhost:3001` | Comma-separated allowed browser origins. |
| `PROXY_JWT_TTL_SECONDS` | `900` | TTL for API-issued internal runtime JWTs used by proxy and services. |
| `INTERNAL_SERVICE_JWT_PRIVATE_JWK` | empty | Private JWK used by the API to sign internal service runtime JWTs. |
| `INTERNAL_SERVICE_JWT_KEY_ID` | `internal-service-1` | `kid` published in the internal JWKS and embedded in signed tokens. |
| `AUTH_URL` | empty | URL the API uses for auth-related self references and local auth flows. |
| `AUTH_PROXY_ENABLED` | `true` | Enables `/auth/v1/*` GoTrue passthrough. |
| `GOTRUE_URL` | empty | Base URL for the GoTrue service. |
| `GOTRUE_ANON_KEY` | empty | GoTrue anon key used for browser auth flows. |
| `GOTRUE_SERVICE_ROLE_KEY` | empty | GoTrue service-role key used by auth admin operations. |
| `GOTRUE_HOOK_SECRET` | empty | Shared secret for `/internal/auth/token-hook` verification. |
| `GOTRUE_REQUEST_TIMEOUT_MS` | `5000` | Timeout for proxied GoTrue requests. |
| `CONNECTOR_OSV_ENABLED` | `true` | Enables or disables the OSV connector. |
| `OSV_API_URL` | `https://api.osv.dev` | Override OSV base URL. |
| `CONNECTOR_OSV_CACHE_TTL_SECONDS` | `3600` | Freshness window for cached OSV results. |
| `CONNECTOR_OSV_RESPONSE_TIMEOUT_MS` | `2000` | Per-request response deadline before fail-closed behavior. |
| `CONNECTOR_OSV_BACKGROUND_TIMEOUT_MS` | `30000` | Background HTTP timeout for the longer-running OSV fetch. |
| `CONNECTOR_CONTRIBUTOR_ENABLED` | `true` | Enables or disables the contributor risk connector. |
| `CONNECTOR_CONTRIBUTOR_CACHE_TTL_SECONDS` | `3600` | Freshness window for cached contributor results. |
| `CONNECTOR_CONTRIBUTOR_RESPONSE_TIMEOUT_MS` | `3000` | Per-request response deadline for contributor lookup. |
| `CONNECTOR_CONTRIBUTOR_CACHE_TTL_OVERRIDE_SECONDS` | unset | Optional development TTL override for contributor caches. |
| `CONNECTOR_INTELLIGENCE_ENABLED` | `false` | Enables or disables the intelligence connector. |
| `INTELLIGENCE_API_URL` | `http://intelligence:8001` | Base URL for the internal intelligence service. |
| `CONNECTOR_INTELLIGENCE_CACHE_TTL_SECONDS` | `3600` | Freshness window for cached intelligence results. |
| `CONNECTOR_INTELLIGENCE_RESPONSE_TIMEOUT_MS` | `1500` | Per-request response deadline for intelligence lookups. |
| `CONNECTOR_INTELLIGENCE_BACKGROUND_TIMEOUT_MS` | `10000` | Background HTTP timeout for the intelligence request. |

## Important Operational Notes

- `GET /healthz` returns `503` until the API can successfully query the
  database
- `GET /internal/bootstrap/status/detail` and
  `POST /internal/bootstrap/first-user` are intentionally protected by
  `BOOTSTRAP_FIRST_USER_SECRET`; generate a strong random value and keep it out
  of logs and client-side config
- MCP agent transport is served at `/api/mcp`; OAuth discovery metadata still
  lives under the `/mcp`-scoped `.well-known` routes
- request-body limits are enforced at the app boundary for both JSON and
  raw-text bodies
- CORS allowlists are explicit; the API returns the first configured origin
  when the incoming origin is not allowed
- ConnectRPC requests copy `X-Forwarded-For` into `x-proxy-remote-addr` before
  handing off to the gateway handler
- connector startup failures are logged; the process stays up unless startup
  itself throws

## Code Organization

- `src/app/`
  - app bootstrap, server assembly, and startup wiring
- `src/auth/`
  - auth claims, GoTrue client and proxy helpers, and auth admin service
- `src/http/`
  - shared response helpers, validation helpers, and access guards
- `src/connect/`
  - proxy-facing ConnectRPC gateway handlers
- `src/connectors/`
  - connector interfaces, runtime, registry, cache, and implementations
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

## Further Reading

- [Root README](../../README.md)
- [OSS Architecture](../../docs/architecture.md)
- [OpenAPI export](docs/openapi.json)
- [AGENTS.md](AGENTS.md)

## Technical Debt

- Upgrade the API from Zod 3 to Zod 4 before expanding the REST OpenAPI
  rollout beyond the current bootstrap and token slice. The first OpenAPI
  export was implemented with `@hono/zod-openapi` on an older compatibility
  line because the service still depends on Zod 3.
