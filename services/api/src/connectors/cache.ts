/**
 * Connector cache layer — all DB reads and writes for connector results.
 *
 * Staleness is determined at runtime: a cache entry is fresh if
 *   queried_at > now() - connector.config.cacheTtlSeconds
 * The TTL is never stored in the DB — changing *_CACHE_TTL_SECONDS takes
 * effect immediately without a migration or row update.
 *
 * All connector detail (findings, signals) lives in connector_cache.data JSONB.
 * Promoted aggregate columns (risk_tier, risk_score, finding_count, etc.) are
 * kept as real columns for fast SQL aggregate queries without GIN index scans.
 *
 * CacheData shape:
 *   {
 *     score_model_version: string,
 *     findings: Array<{
 *       id: string,
 *       severity: string,
 *       title: string | null,
 *       published_at: string | null,   // ISO 8601 UTC
 *       attributes: Record<string, unknown>
 *     }>
 *   }
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { connector_cache } from "../db/schema.js";
import type { DB } from "../db/index.js";
import { SEVERITY_INDEX } from "./types.js";
import type {
  ConnectorArtifactEvent,
  ConnectorSnapshot,
  PackageIntelligenceConnector,
  ConnectorResultSummary,
  ConnectorResult,
  RemediationSummary,
  RiskSummary,
  VulnerabilitySummary,
  VulnSeverity,
} from "./types.js";
import { eventEntityContext } from "./events.js";

// ---------------------------------------------------------------------------
// CacheData — the JSONB shape stored in connector_cache.data.
// All connectors produce this envelope; connector-specific detail lives in
// finding.attributes. Typed here for clarity; cast with `as CacheData` on read.
// ---------------------------------------------------------------------------
export interface CacheFinding {
  id: string;
  severity: string;
  title: string | null;
  published_at: string | null; // ISO 8601 UTC
  attributes: Record<string, unknown>;
}

export interface CacheData {
  score_model_version: string;
  findings: CacheFinding[];
  summary?: ConnectorResultSummary;
}

type ConnectorCacheIdentity = {
  event: ConnectorArtifactEvent;
};

function connectorCacheIdentityFromEvent(
  event: ConnectorArtifactEvent,
): ConnectorCacheIdentity {
  return {
    event,
  };
}

function vulnerabilitySummaryFromResult(
  result: ConnectorResult,
): NonNullable<ConnectorResultSummary["vulnerability"]> {
  const legacyResult = isLegacyVulnerabilityResult(result) ? result : null;
  const maxFindingSeverity = highestFindingSeverity(result);
  return (
    result.summary?.vulnerability ?? {
      maxSeverity: legacyResult?.maxSeverity ?? maxFindingSeverity,
      findingCount: legacyResult?.vulnCount ?? result.findings.length,
      fixAvailable: legacyResult?.fixAvailable ?? false,
      bestFixVersion: legacyResult?.bestFixVersion ?? null,
      ...(legacyResult?.severityCounts
        ? { severityCounts: legacyResult.severityCounts }
        : {}),
    }
  );
}

function highestFindingSeverity(result: ConnectorResult): VulnSeverity {
  let highest: VulnSeverity = "NONE";
  for (const finding of result.findings) {
    if (SEVERITY_INDEX[finding.severity] < SEVERITY_INDEX[highest]) {
      highest = finding.severity;
    }
  }
  return highest;
}

function isLegacyVulnerabilityResult(
  result: ConnectorResult,
): result is ConnectorResult & {
  maxSeverity: VulnSeverity;
  vulnCount: number;
  fixAvailable: boolean;
  bestFixVersion: string | null;
  severityCounts?: VulnerabilitySummary["severityCounts"];
} {
  return "maxSeverity" in result && "vulnCount" in result;
}

function riskSummaryFromResult(
  result: ConnectorResult,
  vulnerability: VulnerabilitySummary,
): RiskSummary {
  return (
    result.summary?.risk ?? {
      tier: vulnerability.maxSeverity,
      score: null,
    }
  );
}

function findingsSummaryFromResult(result: ConnectorResult): { count: number } {
  return (
    result.summary?.findings ?? {
      count: result.summary?.vulnerability?.findingCount ?? result.findings.length,
    }
  );
}

function remediationSummaryFromResult(
  result: ConnectorResult,
  vulnerability: VulnerabilitySummary,
): RemediationSummary {
  return (
    result.summary?.remediation ?? {
      available: vulnerability.fixAvailable,
      best: vulnerability.bestFixVersion,
    }
  );
}

// ---------------------------------------------------------------------------
// Return shape for buildCachedSnapshot.
// `findings` carries the per-finding rows so check-service can upsert
// project_findings on cache hits — the same upsert path as fresh fetches.
// ---------------------------------------------------------------------------
export interface CachedSnapshotResult {
  snapshot: ConnectorSnapshot;
  findings: { finding_id: string; severity: string; title: string | null }[];
}

type CacheRow = typeof connector_cache.$inferSelect;

type CacheInterpretationOptions = {
  includeFindings: boolean;
  treatBrokenFindingStateAsMiss?: boolean;
};

async function findFreshCacheRow(
  db: DB,
  connector: PackageIntelligenceConnector,
  identity: ConnectorCacheIdentity,
): Promise<CacheRow | null> {
  const normalizedIdKey = identity.event.packageVersionId
    ? eq(connector_cache.package_version_id, identity.event.packageVersionId)
    : identity.event.packageId && identity.event.kind === "package_metadata"
      ? and(
          eq(connector_cache.package_id, identity.event.packageId),
          isNull(connector_cache.package_version_id),
        )
      : undefined;

  if (!normalizedIdKey) return null;

  const rows = await db
    .select()
    .from(connector_cache)
    .where(
      and(
        eq(connector_cache.connector_id, connector.id),
        normalizedIdKey,
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  const effectiveTtlSeconds =
    row.ttl_seconds ?? connector.config.cacheTtlSeconds;
  const staleCutoff = new Date(Date.now() - effectiveTtlSeconds * 1000);
  return row.queried_at <= staleCutoff ? null : row;
}

function interpretCacheRow(
  row: CacheRow,
  options: CacheInterpretationOptions,
): {
  result: ConnectorResult;
  cacheAgeHours: number;
  findings: { finding_id: string; severity: string; title: string | null }[];
} | null {
  const cacheAgeHours =
    (Date.now() - row.queried_at.getTime()) / (1000 * 60 * 60);
  const cacheData = (row.data ?? {
    score_model_version: "1.0",
    findings: [],
  }) as CacheData;
  const findings = cacheData.findings ?? [];

  if (
    options.treatBrokenFindingStateAsMiss &&
    row.finding_count > 0 &&
    findings.length === 0
  ) {
    return null;
  }

  const severityCounts = {
    critical: findings.filter((f) => f.severity === "CRITICAL").length,
    high: findings.filter((f) => f.severity === "HIGH").length,
    medium: findings.filter((f) => f.severity === "MEDIUM").length,
    low: findings.filter((f) => f.severity === "LOW").length,
  };

  return {
    result: {
      summary: cacheData.summary ?? {
        risk: {
          tier: row.risk_tier as VulnerabilitySummary["maxSeverity"],
          score: row.risk_score ?? null,
        },
        findings: {
          count: row.finding_count,
        },
        remediation: {
          available: row.remediation_available,
          best: row.best_remediation,
        },
        vulnerability: {
          maxSeverity: row.risk_tier as VulnerabilitySummary["maxSeverity"],
          findingCount: row.finding_count,
          fixAvailable: row.remediation_available,
          bestFixVersion: row.best_remediation,
          ...(findings.length > 0 ? { severityCounts } : {}),
        },
      },
      findings: options.includeFindings
        ? findings.map((finding) => ({
            findingId: finding.id,
            severity: finding.severity as VulnerabilitySummary["maxSeverity"],
            title: finding.title,
            publishedAt: finding.published_at
              ? new Date(finding.published_at)
              : null,
            attributes: finding.attributes,
          }))
        : [],
    },
    cacheAgeHours,
    findings: findings.map((finding) => ({
      finding_id: finding.id,
      severity: finding.severity,
      title: finding.title,
    })),
  };
}

// ---------------------------------------------------------------------------
// buildCachedSnapshot
// Queries connector_cache (with TTL check) and extracts per-finding detail
// from data JSONB. On a hit, calls connector.normalizeToSnapshot() so the
// snapshot is produced through the same code path as a live fetch.
// Returns null on a cache miss.
// ---------------------------------------------------------------------------
export async function buildCachedSnapshot(
  db: DB,
  connector: PackageIntelligenceConnector,
  event: ConnectorArtifactEvent,
  displayName: string,
): Promise<CachedSnapshotResult | null> {
  if (connector.cachePolicy?.readSnapshots === false) {
    return null;
  }

  const identity = connectorCacheIdentityFromEvent(event);
  const row = await findFreshCacheRow(db, connector, identity);
  if (!row) return null;

  const interpreted = interpretCacheRow(row, {
    includeFindings: true,
    treatBrokenFindingStateAsMiss: true,
  });
  if (!interpreted) return null;

  return {
    snapshot: connector.normalizeToSnapshot(
      interpreted.result,
      eventEntityContext(event, displayName, {
        isCacheHit: true,
        responseTimeMs: 0,
        cacheAgeHours: interpreted.cacheAgeHours,
      }),
    ),
    findings: interpreted.findings,
  };
}

// ---------------------------------------------------------------------------
// getCachedResult
// Lightweight cache read returning only aggregate fields — used by connectors
// that don't need per-finding detail (e.g. policy evaluation shortcut paths).
// ---------------------------------------------------------------------------
export async function getCachedResult(
  db: DB,
  connector: PackageIntelligenceConnector,
  event: ConnectorArtifactEvent,
): Promise<ConnectorResult | null> {
  const identity = connectorCacheIdentityFromEvent(event);
  const row = await findFreshCacheRow(db, connector, identity);
  if (!row) return null;

  return (
    interpretCacheRow(row, {
      includeFindings: false,
    })?.result ?? null
  );
}

export async function getPackageScopedCachedResult(
  db: DB,
  connector: PackageIntelligenceConnector,
  event: ConnectorArtifactEvent,
): Promise<ConnectorResult | null> {
  const identity = connectorCacheIdentityFromEvent(event);
  const row = await findFreshCacheRow(db, connector, identity);
  if (!row) return null;

  return (
    interpretCacheRow(row, {
      includeFindings: true,
    })?.result ?? null
  );
}

// ---------------------------------------------------------------------------
// upsertCachedResult
// Writes the full connector result into connector_cache — aggregate columns
// and data JSONB in a single upsert. No child table operations.
// ---------------------------------------------------------------------------
export async function upsertCachedResult(
  db: DB,
  connector: PackageIntelligenceConnector,
  event: ConnectorArtifactEvent,
  result: ConnectorResult,
  /** Explicit TTL override. Falls back to result.ttlSeconds, then null (= use connector config). */
  ttlSeconds?: number,
): Promise<void> {
  // Per-row TTL: explicit arg wins, then result hint, then null (connector config used at read time).
  const effectiveTtl = ttlSeconds ?? result.ttlSeconds ?? undefined;
  const vulnerability = vulnerabilitySummaryFromResult(result);
  const risk = riskSummaryFromResult(result, vulnerability);
  const findingsSummary = findingsSummaryFromResult(result);
  const remediation = remediationSummaryFromResult(result, vulnerability);
  const identity = connectorCacheIdentityFromEvent(event);
  const data: CacheData = {
    score_model_version: "1.0",
    ...(result.summary
      ? { summary: result.summary }
      : { summary: { risk, findings: findingsSummary, remediation, vulnerability } }),
    findings: result.findings.map((f) => ({
      id: f.findingId,
      severity: f.severity,
      title: f.title,
      published_at: f.publishedAt?.toISOString() ?? null,
      attributes: f.attributes,
    })),
  };

  await db
    .insert(connector_cache)
    .values({
      connector_id: connector.id,
      package_id: identity.event.packageId,
      package_version_id: identity.event.packageVersionId,
      risk_tier: risk.tier,
      risk_score: risk.score,
      finding_count: findingsSummary.count,
      remediation_available: remediation.available,
      best_remediation: remediation.best,
      data,
      ttl_seconds: effectiveTtl ?? null,
      queried_at: new Date(),
    })
    .onConflictDoUpdate({
      target: identity.event.packageVersionId
        ? [connector_cache.connector_id, connector_cache.package_version_id]
        : [connector_cache.connector_id, connector_cache.package_id],
      targetWhere: identity.event.packageVersionId
        ? sql`${connector_cache.package_version_id} IS NOT NULL`
        : sql`${connector_cache.package_id} IS NOT NULL AND ${connector_cache.package_version_id} IS NULL`,
      set: {
        risk_tier: risk.tier,
        risk_score: risk.score,
        package_id: identity.event.packageId,
        package_version_id: identity.event.packageVersionId,
        finding_count: findingsSummary.count,
        remediation_available: remediation.available,
        best_remediation: remediation.best,
        data,
        ttl_seconds: effectiveTtl ?? null,
        queried_at: new Date(),
      },
    });
}

export async function upsertPackageScopedCachedResult(
  db: DB,
  connector: PackageIntelligenceConnector,
  event: ConnectorArtifactEvent,
  result: ConnectorResult,
  ttlSeconds?: number,
): Promise<void> {
  return upsertCachedResult(
    db,
    connector,
    event,
    result,
    ttlSeconds,
  );
}

// ---------------------------------------------------------------------------
// upsertCachedResultWithFindings — preferred exported name for generic
// connector result caching.
// ---------------------------------------------------------------------------
export const upsertCachedResultWithFindings = upsertCachedResult;
