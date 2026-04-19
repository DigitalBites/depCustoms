# Customs Proxy Service

Scope: `services/proxy`

This service is the Customs data-plane proxy. It accepts npm and PyPI package-manager traffic, enforces policy decisions from the control plane, serves allowed requests by redirect or pull-through, and durably records usage events in a local write-ahead log for at-least-once delivery.

## What This Service Does

- accepts npm traffic on `/` and PyPI traffic on `/pypi/`
- parses package identity and artifact vs metadata requests per ecosystem
- requires a project bearer token for both metadata and artifact requests
- checks a local in-memory decision cache before calling the control plane
- fails closed on fresh requests when the control plane is unavailable
- records usage events durably in a local NDJSON WAL
- streams undelivered WAL events to the control plane in the background
- rewrites npm/PyPI metadata so future artifact downloads route back through the proxy
- exposes `/healthz` based on control-plane reachability
  and runtime-token refresh health

## Request Flow

For both npm and PyPI, the proxy follows one shared request pipeline in `internal/handler/engine.go`:

1. parse the inbound request through the ecosystem resolver
2. require `Authorization: Bearer <project-token>`
3. look up the decision in the local cache
4. on cache hit, serve the decision immediately
5. on cache miss, call the control plane `Check` RPC
6. if the control plane is unavailable, fail closed
7. if allowed, serve by redirect or pull-through according to the returned serve mode
8. write usage events to the WAL and flush them asynchronously through `RecordUsage`

Important behavior:

- metadata and artifact requests both stay on the shared policy path
- cache hits can still be served while the control plane is unreachable
- cache misses fail closed when the control plane cannot be reached
- block/degraded events are written durably before the response returns
- allow events are written after serving so the WAL captures final serve outcome details

## Supported Ecosystems

### npm

- metadata requests fetch package metadata from `https://registry.npmjs.org`
- tarball URLs in metadata responses are rewritten to the proxy public base URL
- allowed artifacts are served either by:
  - `SERVE_MODE_REDIRECT` to the canonical npm tarball URL
  - `SERVE_MODE_PULL` by streaming the tarball through the proxy

### PyPI

- metadata requests fetch package simple-index pages from `https://pypi.org`
- file download links are rewritten from `https://files.pythonhosted.org/packages/...` to the proxy `/pypi/packages/...` path
- allowed artifacts are served either by:
  - `SERVE_MODE_REDIRECT` to `files.pythonhosted.org`
  - `SERVE_MODE_PULL` by streaming the file through the proxy

## Runtime Surfaces

- `GET /healthz`
  - returns `200` with `{"status":"ok"}` when the control plane is reachable and runtime-token refresh is healthy
  - returns `503` with `{"status":"degraded","reason":"control_plane_unreachable"}` when the control plane is not reachable
  - returns `503` with `{"status":"degraded","reason":"token_refresh_failed"}` when the control plane is reachable but runtime-token refresh is unhealthy

- `/`
  - npm traffic

- `/pypi/`
  - PyPI traffic

The proxy does not expose a separate browser/admin REST API. Its main external dependency is the control-plane ConnectRPC `GatewayService`.

## Control Plane Interaction

The proxy uses `internal/client/` to call the API's ConnectRPC gateway:

- `GatewayService.Check`
  - returns the decision, reason, TTL, serve mode, tenant ID, and project ID
- `GatewayService.RecordUsage`
  - accepts WAL events in a client-streaming RPC
- `GatewayService.RecordProxyStatus`
  - records lifecycle and connectivity events such as startup, reconnection, and shutdown

Proxy authentication is attached on every RPC via:

- `x-proxy-id`
- `x-proxy-secret`

## Caching and WAL Behavior

### Decision Cache

- in-memory only
- keyed by project token hash, ecosystem, package, and version
- populated from successful `Check` responses
- TTL controlled by `PROXY_CACHE_TTL_SECONDS`

### WAL

The write-ahead log lives in `internal/wal/` and provides durable event delivery:

- events are appended as NDJSON
- a checkpoint file tracks delivered byte offset
- undelivered events are replayed after restart
- the runtime maintains a persistent `RecordUsage` stream in the background
- successful delivery advances the checkpoint
- compaction prunes delivered events older than `PROXY_EVENT_RETENTION_HOURS`
- compaction uses atomic rename to avoid partial-file corruption

## Startup and Shutdown

On boot, the proxy:

1. loads and validates config from environment variables
2. logs a sanitized startup config snapshot
3. opens the WAL and constructs runtime dependencies
4. builds the HTTP server and ecosystem handlers
5. starts background workers for control-plane health probing and WAL delivery
6. starts the HTTP server

During runtime:

- control-plane health is probed continuously
- the WAL delivery stream is recycled in bounded batches based on `PROXY_FLUSH_MAX_EVENTS`
- status events are reported when the control plane becomes available/unavailable

On shutdown:

- the HTTP server is shut down gracefully
- the proxy best-effort reports `proxy_service_stopped` to the control plane

## Development

### Install / Dependencies

```bash
go mod tidy
```

### Run Locally

```bash
go run ./cmd/proxy
```

### Tests

```bash
go test ./...
```

### Build

```bash
go build ./cmd/proxy
```

## Environment Variables

The proxy reads configuration from `internal/config/config.go`.

### Core Runtime

| Variable | Default | Required | Purpose |
| --- | --- | --- | --- |
| `ENVIRONMENT` | `development` | no | Runtime environment label |
| `LOG_LEVEL` | `info` | no | Logged in startup config; current entrypoint still initializes JSON logging at info level |

### Server / Identity

| Variable | Default | Required | Purpose |
| --- | --- | --- | --- |
| `PROXY_PORT` | `8080` | no | HTTP listen port |
| `PROXY_PUBLIC_BASE_URL` | none | yes | Public proxy base URL used for npm/PyPI metadata rewriting |
| `PROXY_NPM_METADATA_MAX_BYTES` | `33554432` | no | Maximum npm metadata response size accepted from upstream |
| `PROXY_NPM_AUDIT_MAX_BODY_BYTES` | `5242880` | no | Maximum npm security audit request body size accepted for passthrough |
| `PROXY_PYPI_METADATA_MAX_BYTES` | `2097152` | no | Maximum PyPI metadata response size accepted from upstream |
| `PROXY_ID` | none | yes | Registered proxy UUID |

### Control Plane

| Variable | Default | Required | Purpose |
| --- | --- | --- | --- |
| `PROXY_CONTROL_PLANE_URL` | none | yes | Base URL for the Customs API |
| `PROXY_CONTROL_PLANE_SECRET` | none | yes | Shared secret for proxy authentication |

### Privacy / Trust Boundary

| Variable | Default | Required | Purpose |
| --- | --- | --- | --- |
| `PROXY_REDACT_CLIENT_IP` | `false` | no | Masks client IP before WAL/control-plane reporting |
| `PROXY_TRUSTED_PROXY_CIDRS` | unset | no | CIDR allowlist for trusting forwarded client-IP headers |

### Cache / WAL Delivery

| Variable | Default | Required | Purpose |
| --- | --- | --- | --- |
| `PROXY_CACHE_TTL_SECONDS` | `300` | no | In-memory decision cache TTL |
| `PROXY_PACKAGE_METADATA_CACHE_TTL_SECONDS` | `300` | no | In-memory package metadata summary cache TTL |
| `PROXY_PACKAGE_METADATA_SIGNAL_DEDUPE_TTL_SECONDS` | `300` | no | Dedupe window for repeated package freshness signals |
| `PROXY_METADATA_CACHE_STATS_REPORT_INTERVAL_SECONDS` | `60` | no | Reporting cadence for aggregate package metadata cache telemetry |
| `PROXY_FLUSH_INTERVAL_SECONDS` | `10` | no | Background flush cadence for pending WAL events |
| `PROXY_FLUSH_MAX_EVENTS` | `100` | no | Maximum events sent before recycling the current usage stream |
| `PROXY_EVENT_RETENTION_HOURS` | `48` | no | Retention window for delivered WAL events during compaction |
| `PROXY_WAL_PATH` | `./data/events.ndjson` | no | Path to the NDJSON WAL file |
| `PROXY_CHECKPOINT_PATH` | `./data/events.checkpoint` | no | Path to the WAL checkpoint file |

### Contributor Metadata Collection

| Variable | Default | Required | Purpose |
| --- | --- | --- | --- |
| `PROXY_CONNECTOR_CONTRIBUTOR_ENABLED` | `true` | no | Enables proxy-side contributor metadata collection and signal emission |
| `PROXY_CONNECTOR_CONTRIBUTOR_PREFETCH_WINDOW_DAYS` | `90` | no | Look-back window used when building the exact-version contributor history slice |
| `PROXY_CONTRIBUTOR_METADATA_CACHE_PATH` | `./data/contributor_metadata_cache.json` | no | Path to the persisted contributor metadata cache |
| `PROXY_CONTRIBUTOR_METADATA_VERSION_CAP` | `250` | no | Maximum versions retained per package in the contributor metadata cache |
| `PROXY_CONTRIBUTOR_METADATA_COLD_DAYS` | `45` | no | Cold-history threshold used when pruning contributor metadata |

## Important Operational Notes

- `PROXY_PUBLIC_BASE_URL` is required and normalized; query strings and fragments are rejected
- `/healthz` reflects control-plane reachability, not upstream registry reachability
- the proxy currently trusts forwarded client IPs only from configured `PROXY_TRUSTED_PROXY_CIDRS`
- npm metadata responses are capped at 32 MiB; npm security audit passthrough bodies are capped at 5 MiB; PyPI metadata responses are capped at 2 MiB
- the HTTP server is hardened with read/write/idle/header limits in `internal/runtime/runtime.go`
- the control-plane client enforces TLS 1.2+ and uses an HTTP/2-capable transport

## Code Organization

Current package ownership:

- `cmd/proxy/`
  - process entrypoint and startup/shutdown composition only
- `internal/config/`
  - environment loading, validation, normalization, and sanitized config logging
- `internal/runtime/`
  - dependency construction, HTTP server wiring, health probing, usage-stream lifecycle, shutdown status reporting
- `internal/handler/`
  - inbound request orchestration, shared policy pipeline, and ecosystem-specific npm/PyPI logic
- `internal/client/`
  - control-plane ConnectRPC client and proxy auth header injection
- `internal/cache/`
  - in-memory decision cache
- `internal/metadata/`
  - proxy-local package metadata summary cache and freshness-signal dedupe cache
- `internal/wal/`
  - durable NDJSON event log, checkpointing, replay, and compaction
- `internal/testutil/`
  - shared test fixtures/helpers
- `gen/`
  - generated protobuf and ConnectRPC artifacts

Boundary rules:

- keep `cmd/proxy/` thin
- keep inbound auth in `internal/handler/engine.go`
- keep outbound proxy auth in `internal/client/client.go`
- keep shared policy/cache/WAL flow centralized in `internal/handler/engine.go`
- keep ecosystem resolvers focused on ecosystem-specific parsing and serving
- do not introduce a generic `models` package

For agent workflow and service-local guardrails, see [AGENTS.md](/workspace/services/proxy/AGENTS.md).
