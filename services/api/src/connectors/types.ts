/**
 * Shared types for the package intelligence connector system.
 *
 * Connectors implement PackageIntelligenceConnector and are registered in
 * registry.ts. The dispatcher/cache layer owns DB I/O, cache hit/miss
 * decisions, and package identity. Connectors handle normalized package events.
 */

// ---------------------------------------------------------------------------
// Severity levels recognised across all connectors
// ---------------------------------------------------------------------------
export type VulnSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";

export const SEVERITY_INDEX: Record<VulnSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  NONE: 4,
};

// ---------------------------------------------------------------------------
// ConnectorFinding — generic per-finding type returned by connectors and
// persisted in connector_cache.data JSONB findings array.
// ---------------------------------------------------------------------------
export interface ConnectorFinding {
  findingId: string; // advisory ID (OSV ID, GHSA, CVE-..., etc.)
  severity: VulnSeverity;
  title: string | null; // short human-readable summary
  publishedAt: Date | null;
  attributes: Record<string, unknown>; // all connector-specific detail
}

// ---------------------------------------------------------------------------
// ConnectorFindingSummary — lightweight per-finding row used by list/detail UIs
// that do not need the full attributes payload.
// ---------------------------------------------------------------------------
export interface ConnectorFindingSummary {
  findingId: string;
  severity: VulnSeverity;
  title: string | null;
  publishedAt: string | null;
}

// ---------------------------------------------------------------------------
// ConnectorFindingField — declares which attributes a connector exposes and
// how to display them. Drives the finding detail cards on connector
// intelligence pages — no hardcoded column names in the UI.
// ---------------------------------------------------------------------------
export interface ConnectorFindingField {
  key: string; // attribute key in ConnectorFinding.attributes
  label: string; // human-readable label shown in the UI
  dataType:
    | "integer"
    | "float"
    | "boolean"
    | "string"
    | "datetime"
    | "string[]";
  display?: "badge" | "code" | "url" | "date" | "number"; // UI rendering hint
}

// ---------------------------------------------------------------------------
// Connector result contracts
// ---------------------------------------------------------------------------
export interface VulnerabilitySummary {
  maxSeverity: VulnSeverity;
  findingCount: number;
  fixAvailable: boolean;
  bestFixVersion: string | null;
  severityCounts?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

export interface ConnectorResultSummary {
  vulnerability?: VulnerabilitySummary;
  [key: string]: unknown;
}

export interface ConnectorResult {
  /**
   * Generic findings list — persisted in connector_cache.data JSONB and used
   * to drive project_findings rows and detail UIs.
   */
  findings: ConnectorFinding[];
  /**
   * Connector-specific aggregate summary blocks. Consumers should prefer these
   * typed blocks over inferring meaning from ad hoc attributes.
   */
  summary?: ConnectorResultSummary;
  /**
   * Optional per-result cache TTL in seconds. When set, upsertCachedResult
   * stores it on the connector_cache row and buildCachedSnapshot uses it for
   * the staleness check instead of the connector's global cacheTtlSeconds.
   * Enables age-based TTL strategies (e.g. contributor connector caches fresh
   * versions for 1 hour, stable versions for 72 hours).
   */
  ttlSeconds?: number;
}

// ---------------------------------------------------------------------------
// Connector event contracts
// ---------------------------------------------------------------------------
export type ConnectorEventSource = "proxy" | "sync" | "manual" | "webhook";

export interface ConnectorEventContext {
  tenantId?: string;
  projectId?: string;
  requestId?: string;
  traceId?: string;
  proxyId?: string;
}

export interface ConnectorArtifactEventBase {
  id: string;
  packageId: string;
  ecosystem: string;
  packageName: string;
  source: ConnectorEventSource;
  observedAt: string;
  context?: ConnectorEventContext;
}

export interface ConnectorPackageMetadataEvent
  extends ConnectorArtifactEventBase {
  kind: "package_metadata";
  packageVersionId: null;
  version: null;
}

export interface ConnectorArtifactRequestEvent
  extends ConnectorArtifactEventBase {
  kind: "artifact_request";
  packageVersionId: string;
  version: string;
}

export type ConnectorArtifactEvent =
  | ConnectorPackageMetadataEvent
  | ConnectorArtifactRequestEvent;

export type ConnectorEventKind = ConnectorArtifactEvent["kind"];

export type ConnectorExecutionMode =
  | "sync_required"
  | "async_preferred"
  | "async_only";

export interface ConnectorEventSubscription {
  kind: ConnectorEventKind;
  executionMode: ConnectorExecutionMode;
}

export interface ConnectorJob {
  id: string;
  connectorId: string;
  eventId: string;
  event: ConnectorArtifactEvent;
  createdAt: string;
}

export type ConnectorEventOutcome =
  | { action: "none" }
  | { action: "cache_result"; result: ConnectorResult }
  | { action: "enqueue"; job: ConnectorJob };

// ---------------------------------------------------------------------------
// Generic UI presentation contracts
// ---------------------------------------------------------------------------
export type ConnectorUiDisposition =
  | "clean"
  | "info"
  | "warning"
  | "elevated"
  | "blocked"
  | "unavailable";

export interface ConnectorUiBadge {
  label: string;
  tone: "neutral" | "good" | "warn" | "bad";
}

export interface ConnectorUiFact {
  label: string;
  value: string;
}

export interface ConnectorUiSummary {
  status: ConnectorSnapshotMeta["status"];
  headline: string;
  disposition?: ConnectorUiDisposition;
  score?: number | null;
  badges?: ConnectorUiBadge[];
  keyFacts?: ConnectorUiFact[];
}

export interface ConnectorPresentation {
  summary: ConnectorUiSummary;
  findings: ConnectorFindingSummary[];
  findingSchema: ConnectorFindingField[];
}

// ---------------------------------------------------------------------------
// ConnectorConfig — configuration every connector carries, set once at startup
// ---------------------------------------------------------------------------
export interface ConnectorConfig {
  cacheTtlSeconds: number; // how long a cached result is considered fresh
  responseTimeoutMs: number; // gateway waits this long per request; fail-closed on breach
  backgroundTimeoutMs: number; // undici aborts the HTTP connection after this (background fetch)
  baseUrl: string; // override for local testing or air-gapped deployments
}

// ---------------------------------------------------------------------------
// ConnectorField — a single typed field declared by a connector.
// Registered in connector_fields table on every startup via getFieldCatalog().
// ---------------------------------------------------------------------------
export interface ConnectorField {
  connectorKey: string;
  fieldKey: string;
  canonicalRef: string;
  label: string;
  description?: string;
  dataType: "integer" | "float" | "boolean" | "string" | "datetime";
  entityType: string;
  operators: string[];
  /** Present on fixed-vocabulary fields; drives multi-select in the rule builder UI. */
  enumValues?: string[];
}

// ---------------------------------------------------------------------------
// ConnectorSnapshotMeta — always-present status block on every snapshot.
// Written even on failure so _meta rules always have a value to evaluate.
// ---------------------------------------------------------------------------
export interface ConnectorSnapshotMeta {
  status:
    | "ok"
    | "cache_hit"
    | "timeout"
    | "unavailable"
    | "error"
    | "background_pending";
  responseTimeMs: number;
  cacheAgeHours: number | null;
  isCacheHit: boolean;
  errorCode?: string;
}

// ---------------------------------------------------------------------------
// EntityContext — request context passed to normalizeToSnapshot()
// ---------------------------------------------------------------------------
export interface EntityContext {
  packageId: string | null;
  packageVersionId: string | null;
  ecosystem: string;
  pkg: string;
  version: string | null;
  displayName: string;
  isCacheHit: boolean;
  responseTimeMs: number;
  cacheAgeHours: number | null;
}

export interface ConnectorRequestContext {
  tenantId?: string;
  projectId?: string;
}

// ---------------------------------------------------------------------------
// ConnectorSnapshot — normalized connector output for one entity.
// Stored in connector_snapshots; the policy engine evaluates against this.
// ---------------------------------------------------------------------------
export interface ConnectorSnapshot {
  connectorKey: string;
  entityType: string;
  packageId: string | null;
  packageVersionId: string | null;
  ecosystem: string;
  packageName: string;
  version: string | null;
  displayName: string;
  fields: Record<string, unknown>; // data fields; empty object ({}) on failure
  meta: ConnectorSnapshotMeta; // always populated, even on failure
  observedAt: string; // UTC ISO 8601
}

// ---------------------------------------------------------------------------
// PackageIntelligenceConnector — interface every connector must implement
// ---------------------------------------------------------------------------
export interface PackageIntelligenceConnector {
  /** Stable identifier — used as connector_id in connector_cache rows */
  readonly id: string;

  /** Connector-level config (TTL, timeouts, base URL) */
  readonly config: ConnectorConfig;

  /** Ecosystems this connector can handle. Unsupported events are skipped. */
  readonly supportedEcosystems: readonly string[] | "all";

  /** Event kinds this connector subscribes to and their execution mode. */
  readonly subscribedEvents: readonly ConnectorEventSubscription[];

  /** Connector-specific support checks beyond static ecosystem/kind matching. */
  supportsEvent(event: ConnectorArtifactEvent): boolean;

  /**
   * Handle a normalized package event.
   * Connectors do NOT manage caching — that is the dispatcher/cache layer's
   * responsibility. Called only when a supported event needs execution.
   */
  handleEvent(
    event: ConnectorArtifactEvent,
    requestContext?: ConnectorRequestContext,
  ): Promise<ConnectorEventOutcome>;

  /** Set up HTTP clients, verify connectivity. Called once at API startup. */
  initialize(): Promise<void>;

  /** Tear down connections cleanly. Called on graceful shutdown. */
  shutdown(): Promise<void>;

  /**
   * Declare the typed fields this connector exposes.
   * Called by registerAllFields() on every startup to upsert connector_fields.
   * Both data fields and _meta fields must be included.
   */
  getFieldCatalog(): ConnectorField[];

  /**
   * Normalize a ConnectorResult (or failure) into a ConnectorSnapshot for DB storage
   * and policy evaluation. Always returns a snapshot — on failure, fields is {}
   * and meta.status reflects the failure mode.
   */
  normalizeToSnapshot(
    result: ConnectorResult | null,
    context: EntityContext,
    failureStatus?: ConnectorSnapshotMeta["status"],
    errorCode?: string,
  ): ConnectorSnapshot;

  /**
   * Declare the shape of per-finding attributes this connector writes into
   * connector_cache.data findings[].attributes. Used by the connector
   * intelligence page to render finding detail cards without hardcoded column names.
   */
  getFindingSchema(): ConnectorFindingField[];

  /**
   * Build a generic connector presentation model for UI summary/detail views.
   * This stays schema-driven by default; connectors should only add richer
   * presentation logic when the generic summary/findings/detail layout is not enough.
   */
  buildPresentation?(
    result: ConnectorResult | null,
    snapshot: ConnectorSnapshot,
  ): ConnectorPresentation;
}
