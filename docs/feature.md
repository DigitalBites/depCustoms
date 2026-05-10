# Connector Artifact Event Model

## Purpose

Move package intelligence connectors from direct string-based calls to a normalized artifact event model.

This is a hard cutover. We are not preserving `entityId`, loose string invocation, or migration-only compatibility paths. The API/platform owns package identity, catalog lookup, display naming, cache association, and persistence. Connectors receive typed package events and return identity-free intelligence results.

## Current State

The API now normalizes package identity and resolves catalog IDs before policy evaluation. Dashboard/API surfaces and connector snapshots have already moved away from `entityId`.

The remaining issue is the connector interface. Today the check flow still calls connectors directly with positional strings:

```ts
connector.fetchSignals(ecosystem, packageName, version, context)
```

That call shape hides important distinctions:

- package-level metadata work
- package-version/artifact work
- connector ecosystem support
- synchronous policy checks
- asynchronous or background enrichment
- platform-owned cache hit/miss handling

## Target Rules

- API owns inbound package parsing and normalization.
- API owns package catalog lookup and UUID resolution.
- API owns display names.
- API owns connector cache lookup, hit/miss decisions, TTL checks, timeout handling, snapshots, and project finding persistence.
- Package catalog identity is global. `packages`, `package_versions`, `connector_cache`, and connector facts are not tenant-scoped.
- Tenant/project/request details are optional observation context, not package identity.
- Connectors declare what ecosystems and event kinds they support.
- Connectors translate canonical package identity into provider-specific request formats.
- Connectors parse provider responses into normalized connector results.
- Connectors do not parse raw package manager URLs, filenames, purls, or package refs.
- Connectors do not resolve `package_id` or `package_version_id`.
- Connectors do not compute display names.
- Connectors do not query `connector_cache`.
- Connectors do not return package IDs as persistence authority.
- Unsupported connector events are skipped and do not write empty/clean cache rows.

## Event Scope

Connector events are global package events with optional observation context.

Global fields identify the package or package version. The optional `context` block explains why we are asking now. This keeps cache and connector data globally reusable while still allowing project-scoped snapshots/findings when the event came from a project check.

```ts
type ConnectorEventSource = "proxy" | "sync" | "manual" | "webhook";

type ConnectorEventContext = {
  tenantId?: string;
  projectId?: string;
  requestId?: string;
  traceId?: string;
  proxyId?: string;
};

type ConnectorArtifactEventBase = {
  id: string;
  packageId: string;
  ecosystem: string;
  packageName: string;
  source: ConnectorEventSource;
  observedAt: string;
  context?: ConnectorEventContext;
};
```

## Event Types

Use a discriminated union. Keep package-level and version-level events separate even though most fields overlap because their cache keys, policy use, and connector behavior differ.

```ts
type ConnectorPackageMetadataEvent = ConnectorArtifactEventBase & {
  kind: "package_metadata";
  packageVersionId: null;
  version: null;
};

type ConnectorArtifactRequestEvent = ConnectorArtifactEventBase & {
  kind: "artifact_request";
  packageVersionId: string;
  version: string;
};

type ConnectorArtifactEvent =
  | ConnectorPackageMetadataEvent
  | ConnectorArtifactRequestEvent;
```

`package_metadata` is for package-level intelligence: maintainers, publisher facts, repository facts, project health, name reputation, and other data that does not require a specific version.

`artifact_request` is for version-level intelligence: vulnerabilities, release facts, version age, fix availability, and anything that needs a specific package version.

We are not introducing `package_version_metadata` yet. If a connector needs a version, it handles `artifact_request`.

## Connector Contract

Target connector interface:

```ts
type ConnectorEventKind = ConnectorArtifactEvent["kind"];

type ConnectorExecutionMode =
  | "sync_required"
  | "async_preferred"
  | "async_only";

type ConnectorEventSubscription = {
  kind: ConnectorEventKind;
  executionMode: ConnectorExecutionMode;
};

type ConnectorEventOutcome =
  | { action: "none" }
  | { action: "cache_result"; result: ConnectorResult }
  | { action: "enqueue"; job: ConnectorJob };

interface PackageIntelligenceConnector {
  readonly id: string;
  readonly config: ConnectorConfig;
  readonly supportedEcosystems: readonly string[] | "all";
  readonly subscribedEvents: readonly ConnectorEventSubscription[];

  supportsEvent(event: ConnectorArtifactEvent): boolean;

  handleEvent(
    event: ConnectorArtifactEvent,
    context?: ConnectorRequestContext,
  ): Promise<ConnectorEventOutcome>;

  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  getFieldCatalog(): ConnectorField[];
  getFindingSchema(): ConnectorFindingField[];
  buildPresentation?(
    result: ConnectorResult | null,
    snapshot: ConnectorSnapshot,
  ): ConnectorPresentation;
}
```

Hard cutover removals:

- Remove `fetchSignals(ecosystem, pkg, version, context)` from the interface.
- Remove call paths that invoke connectors with positional package strings.
- Remove connector-side assumptions that package-level cache is represented by a synthetic public version.
- Remove connector output as an identity source.

## Connector Result Shape

Connector results remain identity-free.

```ts
type ConnectorResult = {
  findings: ConnectorFinding[];
  summary?: ConnectorResultSummary;
  ttlSeconds?: number;
};
```

The event envelope supplies:

- connector cache identity
- snapshot identity
- project finding identity
- display-name inputs
- trace/request association

The result supplies:

- findings
- summaries
- policy fields
- provider-specific attributes
- optional TTL

This avoids repeating `packageId`, `packageVersionId`, `ecosystem`, `packageName`, `version`, or `displayName` inside provider result data.

## Association Between Event and Result

Synchronous connector execution keeps association in the dispatcher call frame:

```ts
const event = buildConnectorArtifactEvent(...);
const outcome = await connector.handleEvent(event, context);

await persistConnectorOutcome({
  connectorId: connector.id,
  event,
  outcome,
});
```

For async/background work, the job stores the full event envelope. Job completion persists by replaying that event envelope with the outcome.

```ts
type ConnectorJob = {
  id: string;
  connectorId: string;
  eventId: string;
  event: ConnectorArtifactEvent;
  createdAt: string;
};
```

```ts
await persistConnectorOutcome({
  connectorId: job.connectorId,
  event: job.event,
  outcome,
});
```

Connectors do not echo IDs back for association. The platform owns the event/job/outcome relationship.

## Dispatcher Rules

The dispatcher is the only entry point for connector execution.

For each event:

1. Select enabled connectors.
2. Skip connectors whose `subscribedEvents` do not include the event kind.
3. Skip connectors whose `supportedEcosystems` do not include the event ecosystem.
4. Call `supportsEvent(event)` for connector-specific support checks.
5. For unsupported events, stop. Do not write cache rows or clean snapshots.
6. For supported events, let the platform cache layer decide hit, stale, miss, refresh, or enqueue.
7. Invoke `handleEvent()` only when execution is needed.
8. Persist outcomes using the original event identity.

Unsupported is not the same as a clean result. A connector that does not support PyPI should not create a PyPI cache row that says zero findings.

## Caching And Timeouts

Caching remains platform-owned. Connectors do not decide cache hit/miss.

Cache authority is ID-based:

- `artifact_request`: `(connector_id, package_version_id)`
- `package_metadata`: `(connector_id, package_id, package_version_id IS NULL)`

Package-level cache rows use `package_version_id = null` and `version = null`. No synthetic package-scope version value is used in connector events, connector output, API payloads, display names, dashboard contracts, or connector cache writes.

For each connector event, the dispatcher/cache layer should:

1. Resolve the connector cache key from event IDs.
2. Check `connector_cache`.
3. Treat a row as a hit only when connector ID, package identity, event scope, and TTL match.
4. Build a connector snapshot from cached data on hit.
5. Dispatch to the connector only on miss, stale, forced refresh, or missing supported cache state.

Timeout behavior for `sync_required` remains platform-owned:

```txt
cache miss/stale
  -> call connector.handleEvent(event)
  -> race connector request against responseTimeoutMs
  -> if connector returns in time:
       persist cache/snapshot/findings
       evaluate policy with fresh result
  -> if responseTimeoutMs expires:
       return background_pending/unavailable snapshot for current check
       allow original connector promise to continue in background
       persist cache/snapshot/findings when it completes
```

Existing settings still apply:

- `cacheTtlSeconds`: default TTL for connector cache rows.
- `ttlSeconds`: optional per-result TTL returned by connector.
- `responseTimeoutMs`: maximum time a synchronous policy check waits for a connector.
- `backgroundTimeoutMs`: maximum upstream/background request duration.

Required behavior:

- Cache hit uses cached data and marks snapshot metadata as `cache_hit`.
- Cache miss plus successful sync connector result writes cache and uses fresh data.
- Cache miss plus timeout returns a failure/background snapshot for the current policy evaluation.
- Timed-out upstream request may continue in background and update cache when complete.
- Connector failures write snapshot metadata with `unavailable` or `error` where appropriate.
- Unsupported connector events write nothing.

## Execution Modes

Connector event subscriptions declare execution mode:

- `sync_required`: can affect the current policy decision. On cache miss/stale, run during the check up to `responseTimeoutMs`.
- `async_preferred`: use cached data for the current check when available; enqueue refresh on miss/stale or old data.
- `async_only`: never block the current check; enqueue or ignore based on runtime policy.

Initial mapping:

- OSV `artifact_request`: `sync_required`
- Contributor `package_metadata`: `async_preferred`
- Contributor `artifact_request`: `async_preferred` unless a policy rule explicitly needs release-specific contributor data synchronously
- Intelligence `package_metadata`: `async_preferred`
- Intelligence `artifact_request`: `sync_required` only if policy evaluation depends on it; otherwise `async_preferred`

## Persistence Rules

Persistence attaches platform IDs from the event, not from connector output.

Use event data for:

- `connector_cache.package_id`
- `connector_cache.package_version_id`
- `connector_snapshots.package_id`
- `connector_snapshots.package_version_id`
- `project_findings.package_id`
- `project_findings.package_version_id`
- logs and trace correlation

Use connector output for:

- findings
- summaries
- policy fields
- provider-specific attributes
- optional provider trace/debug metadata later

Project-scoped writes only occur when the event has project context:

- `connector_cache` is global.
- package-level connector facts are global.
- connector snapshots may be project-scoped because policy evaluation is project-scoped.
- `project_findings` is project-scoped and requires `context.tenantId` plus `context.projectId`.

## Current Connector Mapping

OSV:

- `supportedEcosystems`: `["npm", "pypi"]`
- `subscribedEvents`: `[{ kind: "artifact_request", executionMode: "sync_required" }]`
- Uses canonical `ecosystem`, `packageName`, and `version` to query OSV.
- Returns vulnerability findings and `summary.vulnerability`.

Contributor:

- `supportedEcosystems`: initially `["npm"]`
- `subscribedEvents`: `package_metadata` and possibly `artifact_request`
- Existing contributor prefetch/manifest event path should be absorbed into or wrapped by `package_metadata`.
- Uses package-level events for maintainer, publisher, repository, and release-history facts.
- Uses artifact events only when release/version context is required.

Intelligence:

- `supportedEcosystems`: implementation-defined, likely `["npm", "pypi"]` or `"all"`
- `subscribedEvents`: `package_metadata` and possibly `artifact_request`
- Uses package-level events for reputation, name similarity, project health, and ecosystem intelligence.
- Uses artifact events only when version context matters.

## Runtime Flow

Live check flow:

```txt
Check request
  -> parse and normalize package request
  -> resolve package_id and package_version_id
  -> build artifact_request event with optional project context
  -> dispatch to subscribed/supporting connectors
  -> use cache or execute connector by execution mode
  -> persist connector outcome using original event IDs
  -> evaluate policy from snapshots
```

Metadata refresh flow:

```txt
Package observed or metadata refresh requested
  -> normalize package
  -> resolve package_id
  -> build package_metadata event
  -> dispatch to subscribed/supporting connectors
  -> persist connector outcome or enqueue background job
```

Queued background flow:

```txt
Connector event needs async work
  -> persist job with full event envelope
  -> worker consumes job
  -> connector handles event
  -> worker persists connector outcome using original event
```

This first implementation can dispatch synchronously inside the API process. It is event-shaped immediately, and can become queue-backed later without changing connector contracts.

## Schema Implications

No migration compatibility is required, but the final schema should make the new ownership clear.

Required direction:

- Prefer `package_id` and `package_version_id` for connector cache joins and lookups.
- Keep denormalized strings only when useful for debugging, search, or operational readability.
- Do not require string package/version fields as authoritative cache identity once IDs are present.
- Treat `package_version_id = null` as package-level scope.
- Prevent package-level cache rows from requiring synthetic versions.
- Keep global package intelligence outside tenant scope.
- Keep project-scoped policy artifacts tied to tenant/project context.

## Implementation Phases

Because this is a hard cutover, phases are sequencing only, not compatibility layers.

1. Add connector event types, subscriptions, execution modes, and dispatcher types.
2. Replace `fetchSignals()` with `handleEvent()` in the connector interface.
3. Update OSV, Contributor, and Intelligence connectors to consume events.
4. Move live check connector execution through the dispatcher with `artifact_request`.
5. Update cache lookup/write helpers to use event identity and ID-first keys.
6. Update snapshot and project finding persistence to accept `{ connectorId, event, result/status }`.
7. Convert contributor prefetch/manifest handling to `package_metadata`.
8. Remove synthetic package-scope version values from connector cache handling.
9. Update tests around connector dispatch, cache hit/miss, unsupported ecosystems, timeout behavior, and persistence identity.

## Test Requirements

Add or update tests for:

- OSV handles only supported `artifact_request` events.
- Unsupported ecosystem events are skipped with no cache write.
- `package_metadata` creates package-level cache/snapshot data with `packageVersionId: null`.
- `artifact_request` creates version-level cache/snapshot/finding data with `packageVersionId`.
- Cache hit does not call `handleEvent()`.
- Cache stale/miss calls `handleEvent()`.
- Timeout returns current failure/background snapshot and allows background cache update.
- Connector result cannot override package identity.
- Project findings are written only when event context includes tenant/project.
- Contributor package metadata path replaces the old connector-specific prefetch path.

## Decisions

- Hard cutover; no migration-only compatibility path.
- No `entityId` in connector contracts, persistence payloads, dashboard contracts, or API response contracts.
- Package events are global with optional observation context.
- Connectors receive platform-resolved UUIDs but do not resolve them.
- Connectors do not echo UUIDs back for association.
- Connector results are identity-free.
- Dispatcher/cache layer owns hit/miss and timeout behavior.
- Unsupported connector events are skipped without cache writes.
- Package-scope cache rows use null version identity instead of a sentinel string.

## Deferred

- Raw provider debug payload shape and retention policy.
- Full durable queue implementation.
- Tenant/project-specific connector cache policy.
- A separate `package_version_metadata` event kind.
- Dependency graph modeling.
