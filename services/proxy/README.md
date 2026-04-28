# Customs Proxy Service

Scope: `services/proxy`

## Overview

The proxy service is the Customs data plane. It accepts npm and PyPI
package-manager traffic, enforces policy decisions from the control plane,
serves allowed requests by redirect or pull-through, and durably records usage
events in a local write-ahead log for at-least-once delivery.

## Quick Start

For the overall OSS stack and bundled deployment, start at the
[root README](../../README.md).

For local proxy-only development:

```bash
go mod tidy
go run ./cmd/proxy
```

The proxy depends on the API control plane for live policy checks and
runtime-token refresh.

## Tech Stack

- Go
- `net/http`
- ConnectRPC
- `go test`
- `gofmt`

## What This Service Does

- accepts npm traffic on `/` and PyPI traffic on `/pypi/`
- parses package identity and artifact vs metadata requests per ecosystem
- requires a project bearer token for both metadata and artifact requests
- checks a local in-memory decision cache before calling the control plane
- fails closed on fresh requests when the control plane is unavailable
- records usage events durably in a local NDJSON WAL
- streams undelivered WAL events to the control plane in the background
- rewrites npm and PyPI metadata so future artifact downloads route back
  through the proxy
- exposes `/healthz` based on control-plane reachability and runtime-token
  refresh health

## Runtime Surfaces

- `GET /healthz`
  - returns `200` with `{"status":"ok"}` when the control plane is reachable
    and runtime-token refresh is healthy
  - returns `503` with `{"status":"degraded","reason":"control_plane_unreachable"}`
    when the control plane is not reachable
  - returns `503` with `{"status":"degraded","reason":"token_refresh_failed"}`
    when runtime-token refresh is unhealthy
- `/`
  - npm traffic
- `/pypi/`
  - PyPI traffic

The proxy does not expose a separate browser or admin REST API. Its main
external dependency is the control-plane ConnectRPC `GatewayService`.

## Authentication Model

- inbound package-manager requests must include
  `Authorization: Bearer <project-token>`
- the proxy validates policy decisions by calling the control plane, not by
  decoding project tokens locally
- proxy-to-API RPC calls authenticate with:
  - `x-proxy-id`
  - `x-proxy-secret`
- successful bootstrap exchanges return short-lived internal runtime JWTs used
  by the proxy for ongoing control-plane communication

## Development

### Install

```bash
go mod tidy
```

### Run Locally

```bash
go run ./cmd/proxy
```

### Build

```bash
go build ./cmd/proxy
```

### Tests

```bash
go test ./...
```

## Configuration

The proxy reads configuration from `internal/config/config.go`.

| Variable | Default | Description |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | Logged in the startup config snapshot and intended runtime log level for the proxy process. |
| `PROXY_PORT` | `8080` | HTTP listen port for npm and PyPI traffic plus `/healthz`. |
| `PROXY_PUBLIC_BASE_URL` | empty | Canonical public proxy base URL used for npm and PyPI metadata rewriting when configured. |
| `PROXY_ALLOWED_PUBLIC_BASE_URLS` | empty | Comma-separated allowlist of additional valid public proxy base URLs for multi-entrypoint deployments. |
| `PROXY_NPM_METADATA_MAX_BYTES` | `33554432` | Maximum npm metadata response size accepted from upstream before the proxy rejects it. |
| `PROXY_NPM_AUDIT_MAX_BODY_BYTES` | `5242880` | Maximum npm security audit request body size accepted for passthrough endpoints. |
| `PROXY_PYPI_METADATA_MAX_BYTES` | `2097152` | Maximum PyPI metadata response size accepted from upstream before the proxy rejects it. |
| `PROXY_ID` | empty | Registered proxy UUID used when authenticating to the control plane. Required for normal startup. |
| `PROXY_CONTROL_PLANE_URL` | empty | Base URL for the Customs API control plane. Required for normal startup. |
| `PROXY_CONTROL_PLANE_SECRET` | empty | Shared proxy secret used for control-plane authentication. Required for normal startup. |
| `PROXY_REDACT_CLIENT_IP` | `false` | When `true`, masks client IPs before storing or reporting them to the control plane. |
| `PROXY_TRUSTED_PROXY_CIDRS` | empty | Comma-separated CIDR allowlist for peers whose forwarded host, proto, and client-IP headers should be trusted. |
| `PROXY_CACHE_TTL_SECONDS` | `300` | In-memory decision cache TTL for `(project token, ecosystem, package, version)` policy results. |
| `PROXY_TOKEN_CONTEXT_CACHE_TTL_SECONDS` | `900` | TTL for cached project-token context used during control-plane and policy request handling. |
| `PROXY_PACKAGE_METADATA_CACHE_TTL_SECONDS` | `300` | TTL for the proxy-local package metadata summary cache. |
| `PROXY_PACKAGE_METADATA_SIGNAL_DEDUPE_TTL_SECONDS` | `300` | Dedupe window for repeated package metadata freshness signals. |
| `PROXY_METADATA_CACHE_STATS_REPORT_INTERVAL_SECONDS` | `60` | Reporting cadence for aggregate package metadata cache telemetry sent to the control plane. |
| `PROXY_FLUSH_INTERVAL_SECONDS` | `10` | Background cadence for replaying pending WAL events to the control plane. |
| `PROXY_FLUSH_MAX_EVENTS` | `100` | Maximum number of events sent before recycling the current usage stream batch. |
| `PROXY_EVENT_RETENTION_HOURS` | `48` | Retention window for delivered WAL events before compaction prunes them. |
| `PROXY_WAL_PATH` | `./data/events.ndjson` | Path to the persistent NDJSON write-ahead log file. |
| `PROXY_CHECKPOINT_PATH` | `./data/events.checkpoint` | Path to the WAL checkpoint file that tracks delivered byte offsets. |
| `PROXY_CONNECTOR_CONTRIBUTOR_ENABLED` | `true` | Enables proxy-side contributor metadata collection and contributor-risk signal emission. |
| `PROXY_CONNECTOR_CONTRIBUTOR_PREFETCH_WINDOW_DAYS` | `90` | Look-back window, in days, used when building the exact-version contributor history slice. |
| `PROXY_CONTRIBUTOR_METADATA_CACHE_PATH` | `./data/contributor_metadata_cache.json` | Path to the persisted contributor metadata cache on disk. |
| `PROXY_CONTRIBUTOR_METADATA_VERSION_CAP` | `250` | Maximum number of versions retained per package in the contributor metadata cache. |
| `PROXY_CONTRIBUTOR_METADATA_COLD_DAYS` | `45` | Cold-history threshold, in days, used when pruning contributor metadata. |

## Important Operational Notes

- `PROXY_PUBLIC_BASE_URL` is the canonical and default public origin and is
  normalized; query strings and fragments are rejected
- `PROXY_ALLOWED_PUBLIC_BASE_URLS` should list every additional valid public
  proxy origin if the proxy is intentionally reachable through multiple
  external URLs
- `/healthz` reflects control-plane reachability, not upstream registry
  reachability
- npm metadata responses are capped at 32 MiB; npm security audit passthrough
  bodies are capped at 5 MiB; PyPI metadata responses are capped at 2 MiB
- the proxy currently trusts forwarded client IPs only from configured
  `PROXY_TRUSTED_PROXY_CIDRS`
- the HTTP server is hardened with read, write, idle, and header limits in
  `internal/runtime/`

## Code Organization

- `cmd/proxy/`
  - process entrypoint and startup/shutdown composition only
- `internal/config/`
  - environment loading, validation, normalization, and sanitized config
    logging
- `internal/runtime/`
  - dependency construction, HTTP server wiring, health probing, usage-stream
    lifecycle, and shutdown status reporting
- `internal/handler/`
  - inbound request orchestration, shared policy pipeline, and ecosystem
    resolvers
- `internal/client/`
  - control-plane ConnectRPC client and proxy auth header injection
- `internal/cache/`
  - in-memory decision cache
- `internal/metadata/`
  - proxy-local package metadata summary cache and freshness-signal dedupe
    cache
- `internal/wal/`
  - durable NDJSON event log, checkpointing, replay, and compaction
- `internal/testutil/`
  - shared test fixtures and helpers
- `gen/`
  - generated protobuf and ConnectRPC artifacts

## Further Reading

- [Root README](../../README.md)
- [OSS Architecture](../../docs/architecture.md)
- [AGENTS.md](AGENTS.md)
