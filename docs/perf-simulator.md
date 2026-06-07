# Performance Simulator

This document defines the first pragmatic performance-testing slice for Customs.
The goal is to isolate control-plane/API bottlenecks before adding full package
manager end-to-end traffic.

## Goals

- Exercise the real proxy-to-control-plane ConnectRPC API with production-shaped
  payloads.
- Use normal proxy enrollment credentials: proxy ID, proxy secret, and project
  token.
- Measure cold-cache and warm-cache behavior under controlled concurrency.
- Avoid calling real OSV during load tests by pointing the API at a fake local
  OSV server.

## Non-Goals

- Simulating every package manager protocol detail.
- Replacing end-to-end npm, PyPI, or Docker tests.
- Creating a synthetic policy engine.

## Tools

### `proxy-sim`

Location: `services/proxy/cmd/proxy-sim`

`proxy-sim` is an API-first load generator. It authenticates like a real proxy
and drives the GatewayService RPCs directly:

- `Check`
- `RecordUsage`
- `RecordPackageLatestMetadata`
- `RecordPackageUsedVersionMetadata`
- `RecordPackageContributorMetadata`

The simulator reports:

- workload item count and throughput
- operation sample count and observed operation throughput
- request count by top-level operation
- error count by operation and error string
- decision counts for `Check`
- p50, p95, p99, and max latency by operation
- total duration

By default, every successful `Check` also records a matching artifact
`RecordUsage` event and latest/used-version metadata. That makes the benchmark
closer to a real proxy request and causes simulated packages to appear in the
project package inventory. Disable those follow-up writes when you need an
isolated policy-evaluation benchmark:

```bash
customs-proxy-sim -scenario check -record-check-usage=false -record-check-metadata=false
```

When check follow-up writes are enabled, `proxy-sim` reports both the full
top-level `[check]` item latency and the component timings:

- `[check.rpc]` for the policy decision RPC itself
- `[check.record_usage]` for the artifact usage event
- `[check.record_latest_metadata]` for latest metadata
- `[check.record_used_metadata]` for used-version metadata
- `[check.record_contributor_metadata]` for npm contributor metadata

Use `[check.rpc]` to evaluate the critical policy decision path. Use `[check]`
to evaluate the end-to-end simulated proxy request including follow-up writes.

Package names are deterministic by default. That is intentional for warm-cache
comparisons, but it means repeated runs with the same namespace will reuse OSV,
connector, and DB cache state. Use `-package-namespace` to control this:

```bash
# Cold-ish run: new synthetic package identities.
customs-proxy-sim -scenario mixed -package-namespace "sim-$(date +%Y%m%d%H%M%S)"

# Warm replay: run the exact same namespace again.
customs-proxy-sim -scenario mixed -package-namespace "sim-20260607143000"
```

The default namespace is `sim`, which preserves the original deterministic names
such as `@sim/pkg-00001` and `sim-package-00001`.

The first useful scenarios are:

- cold artifact checks for many distinct packages
- warm replay of the same package set
- metadata ingest flood
- mixed RPC traffic
- fake-OSV slow/error behavior

The proxy Docker image also includes this tool as `customs-proxy-sim` so it can
be run from an existing proxy container with `docker compose exec`.

## Scenarios

### `check`

`-scenario check` focuses on the critical artifact decision path. Each simulated
item performs a `Check` RPC. With the default follow-up flags enabled, every
successful check also records:

- one artifact `RecordUsage` event
- one latest metadata record
- one used-version metadata record
- npm contributor metadata when contributor context is enabled

Use this scenario to answer: "How does the critical policy path behave under
load?" Because it records artifact usage by default, packages should appear in
the project package inventory.

Read `[check.rpc]` for the critical RPC latency and `[check]` for the full
simulated request latency.

Disable the follow-up writes when you want to isolate only policy evaluation:

```bash
customs-proxy-sim \
  -scenario check \
  -record-check-usage=false \
  -record-check-metadata=false
```

### `mixed`

`-scenario mixed` creates blended API pressure across policy checks, usage
replay, and metadata ingest. With the default `-metadata-ratio 20`, operations
are approximately:

- 70% `Check`
- 10% latest metadata
- 10% used-version metadata
- 5% `RecordUsage` batches
- 5% contributor metadata

The `Check` operations in `mixed` still use the default follow-up behavior
unless `-record-check-usage=false` or `-record-check-metadata=false` is passed.

Use this scenario to answer: "How does the API behave when checks, WAL-style
usage replay, package metadata ingest, and contributor ingest are all happening
together?"

### `fake-osv`

Location: `services/proxy/cmd/fake-osv`

`fake-osv` implements `POST /v1/query` with configurable latency, error rate,
and vulnerability rate. Point the API at it with:

```bash
OSV_API_URL=http://localhost:8099
```

The proxy Docker image also includes this tool as `customs-fake-osv`.

## Suggested Workflow

1. Start the API against a test database.
2. Start fake OSV:

```bash
cd services/proxy
go run ./cmd/fake-osv -addr :8099 -latency 100ms -vuln-rate 0.05
```

3. Start the API with `OSV_API_URL=http://localhost:8099`.
4. Run a cold simulator pass:

```bash
cd services/proxy
go run ./cmd/proxy-sim \
  -url http://localhost:3000 \
  -proxy-id "$PROXY_ID" \
  -proxy-secret "$PROXY_CONTROL_PLANE_SECRET" \
  -project-token "$PROJECT_TOKEN" \
  -scenario check \
  -requests 1000 \
  -packages 1000 \
  -concurrency 50
```

5. Run the same command again as a warm replay.
6. Compare p95/p99, timeouts, decision counts, and API logs.

For cold-cache comparison runs, change `-package-namespace` between runs. For
warm-cache comparison runs, keep `-package-namespace`, `-packages`, `-seed`, and
the scenario flags identical.

## Docker Image Workflow

The proxy image contains:

- `customs-proxy`
- `customs-proxy-sim`
- `customs-fake-osv`

Run the simulator inside the already-running proxy container:

```bash
cd deploy/docker/all-in-one
docker compose exec proxy customs-proxy-sim \
  -url http://api:3000 \
  -project-token "$PROJECT_TOKEN" \
  -scenario mixed \
  -requests 1000 \
  -packages 1000 \
  -concurrency 50
```

Inside the proxy container, `PROXY_ID` and `PROXY_CONTROL_PLANE_SECRET` are
already available from the service environment. Pass `-project-token` explicitly
or export `PROJECT_TOKEN` in the exec environment.

## Interpretation

If cold runs fail but warm runs are fast, the bottleneck is likely connector
fetching, cache population, or first-write database work. If warm runs still
fail, the bottleneck is likely token lookup, policy evaluation, event writes,
connection limits, or database contention in the request path.

Full npm, PyPI, and Docker package-manager traffic should be added after the
API-first bottlenecks are understood.
