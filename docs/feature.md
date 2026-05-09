# Connector Artifact Event Model

## Purpose

This feature proposes moving package intelligence connectors from direct string-based calls to a normalized artifact event model.

The goal is to keep package identity owned by the API/platform while giving connectors a clear, typed notification contract for package-level and version-level work.

## Current State

Today the check flow calls connectors directly with positional package strings:

```ts
connector.fetchSignals(ecosystem, packageName, version, context)
```

The API already normalizes package identity and resolves catalog IDs before policy evaluation, but the connector interface still receives loose strings. Recent cleanup removed `entityId` from dashboard/API surfaces and connector snapshots, but connector invocation is still not event-shaped.

Current responsibilities:

- API parses inbound proxy/control-plane package requests.
- API normalizes ecosystem, package name, and version.
- API resolves `package_id` and `package_version_id`.
- Connectors receive `ecosystem`, `package`, and `version`.
- API persists connector cache rows, snapshots, and project findings after connector execution.

## Problem

The current connector interface does not clearly distinguish:

- package-level metadata events
- package-version/artifact request events
- connector ecosystem support
- synchronous checks vs background work

It also encourages connector-specific assumptions about artifact identity because the input is just loose strings.

## Design Principles

- The API owns package identity normalization.
- The API owns catalog lookup and UUID resolution.
- The API owns display names.
- Connectors should not parse raw package manager artifacts.
- Connectors should not resolve `package_id` or `package_version_id`.
- Connectors may translate canonical package identity into provider-specific request formats.
- Connector output should not be trusted as the authority for package identity.
- Persistence should associate connector results with the original platform event.

## Event Types

Use a discriminated union with a shared base.

```ts
type ConnectorArtifactEventBase = {
  id: string;
  tenantId?: string;
  projectId?: string;
  packageId: string;
  ecosystem: string;
  packageName: string;
  source: "proxy" | "sync" | "manual" | "webhook";
  observedAt: string;
};

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

## Connector Contract

Proposed connector interface:

```ts
type ConnectorEventKind = ConnectorArtifactEvent["kind"];

type ConnectorEventOutcome =
  | { action: "none" }
  | { action: "cache_result"; result: ConnectorResult }
  | { action: "enqueue"; job: ConnectorJob };

interface PackageIntelligenceConnector {
  readonly id: string;
  readonly config: ConnectorConfig;
  readonly supportedEcosystems: readonly string[] | "all";
  readonly subscribedEvents: readonly ConnectorEventKind[];

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

The connector does not need to echo `packageId` or `packageVersionId` in `ConnectorResult`. The dispatcher persists the result with the original event.

For async/background work, persist the event envelope with the job:

```ts
type ConnectorJob = {
  id: string;
  connectorId: string;
  eventId: string;
  event: ConnectorArtifactEvent;
  createdAt: string;
};
```

When the job completes, persistence still uses the original event:

```ts
await persistConnectorOutcome({
  connectorId: job.connectorId,
  event: job.event,
  outcome,
});
```

## Connector Responsibilities

Connectors should:

- declare supported ecosystems
- declare subscribed event kinds
- decide whether they support a specific event
- translate canonical artifact identity into provider-specific request formats
- parse provider responses
- return normalized connector findings and summaries

Connectors should not:

- parse raw package manager URLs, filenames, purls, or package refs
- compute display names
- resolve package UUIDs
- perform DB joins to find package IDs
- return package IDs as the persistence authority

## Example Connector Behavior

OSV:

- `supportedEcosystems`: `["npm", "pypi"]`
- `subscribedEvents`: `["artifact_request"]`
- Uses `ecosystem`, `packageName`, and `version` to query OSV.
- Returns vulnerability findings.

Contributor:

- `supportedEcosystems`: initially `["npm"]`
- `subscribedEvents`: possibly `["package_metadata", "artifact_request"]`
- Uses package-level events for maintainer/publisher/release history.
- May use artifact events for release-specific facts.

Intelligence:

- `supportedEcosystems`: likely `["npm", "pypi"]` or `"all"` depending on implementation
- `subscribedEvents`: likely `["package_metadata", "artifact_request"]`
- Uses package-level events for typosquat or reputation analysis.
- May use artifact events when version context matters.

## Proposed Runtime Flow

Current direct flow:

```txt
Check request -> call every connector with strings -> persist result
```

Proposed event-shaped synchronous flow:

```txt
Check request
  -> normalize artifact
  -> resolve package/package_version IDs
  -> build artifact_request event
  -> dispatch to subscribed/supporting connectors
  -> persist connector outcome using original event IDs
  -> evaluate policy from snapshots
```

This first phase is event-shaped, but not fully event-driven. Check-service may still synchronously dispatch an event to policy-critical connectors when their results are needed for the current decision.

Future queued event flow:

```txt
Check request or metadata refresh
  -> normalize artifact/package
  -> resolve package IDs
  -> publish connector event
  -> connector worker consumes event
  -> worker persists connector outcome using original event IDs
```

Future metadata flow:

```txt
Package metadata observed or refreshed
  -> normalize package
  -> resolve package ID
  -> build package_metadata event
  -> dispatch to subscribed/supporting connectors
  -> persist connector outcome or enqueue background jobs
```

## Execution Modes

Connector events should support both synchronous and asynchronous execution. This lets the same event contract serve live policy checks and background enrichment.

```ts
type ConnectorExecutionMode =
  | "sync_required"
  | "async_preferred"
  | "async_only";
```

Suggested meaning:

- `sync_required`: the connector can affect the current policy decision. On cache miss/stale, run it during the check up to its response timeout.
- `async_preferred`: use cached data for the current check when available; enqueue refresh on miss/stale or when data is old.
- `async_only`: never block the current check; always enqueue or ignore based on policy.

The connector can expose execution preferences by event kind:

```ts
type ConnectorEventSubscription = {
  kind: ConnectorEventKind;
  executionMode: ConnectorExecutionMode;
};

interface PackageIntelligenceConnector {
  readonly subscribedEvents: readonly ConnectorEventSubscription[];
}
```

Initial implementation can keep this simpler by deriving execution mode from current connector behavior and config, but the contract should leave room for this distinction.

## Caching and Timeouts

Caching remains platform-owned. Connectors do not query `connector_cache` and do not decide cache hit/miss.

For each connector event, the dispatcher/cache layer should:

1. Resolve the connector cache key from the event IDs.
2. Check `connector_cache`.
3. Treat a row as a hit only when it matches the connector and package identity and is still inside TTL.
4. Build a connector snapshot from cached data on hit.
5. Dispatch to the connector only on miss/stale, forced refresh, or unsupported cache state.

The current timeout behavior should be retained for `sync_required` calls:

```txt
cache miss/stale
  -> call connector
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

This preserves the current fail-closed live-check posture while allowing the cache to warm when a slow connector completes after the request deadline.

Open timeout behavior to preserve:

- Cache hit uses cached data and marks snapshot metadata as `cache_hit`.
- Cache miss plus successful sync connector result writes cache and uses fresh data.
- Cache miss plus timeout returns a failure/background snapshot for the current policy evaluation.
- Timed-out upstream request may continue in background and update cache when complete.
- Connector failures write snapshot metadata with `unavailable` or `error` where appropriate.

## Persistence Rules

Persistence should attach platform IDs from the event, not from connector output.

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
- optional provider trace metadata later

## Open Questions

- Do we need a third event kind: `package_version_metadata`, separate from `artifact_request`?
- Should `package_metadata` events be tenant/project-scoped or global by default?
- Which connectors should run synchronously during policy checks versus enqueue background work?
- Is execution mode static per connector/event kind, or policy-configurable per tenant/project?
- How should connector failures map to policy fail-closed behavior for metadata-only events?
- Should event dispatch happen inside check-service initially, or through a connector runtime service module from the start?
- Should connector support be declared as static `supportedEcosystems`, dynamic `supportsEvent`, or both?
- Should queued async connector jobs store the full event envelope or only event ID plus package IDs?

## Suggested Implementation Phases

1. Introduce event types and connector dispatcher without changing connector behavior.
2. Add `supportedEcosystems`, `subscribedEvents`, and `supportsEvent` to connectors.
3. Convert live check connector calls into synchronous `artifact_request` dispatch while preserving current cache/timeout/background completion semantics.
4. Update cache/snapshot/finding persistence to accept `{ event, outcome }`.
5. Add package-level `package_metadata` dispatch for connector sync paths.
6. Add queued background job support for connectors/events that should not block policy evaluation.

## Non-Goals For This Pass

- Debug payload design.
- Raw provider response retention.
- Full job queue implementation.
- Dashboard/UI changes.
- Dependency graph modeling.
