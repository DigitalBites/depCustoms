/**
 * Connector cache layer — all DB reads and writes for connector results.
 *
 * Staleness is determined at runtime: a cache entry is fresh if
 *   queried_at > now() - connector.config.cacheTtlSeconds
 * The TTL is never stored in the DB — changing *_CACHE_TTL_SECONDS takes
 * effect immediately without a migration or row update.
 *
 * All connector detail (findings, signals) lives in connector_cache.data JSONB.
 * Promoted aggregate columns (max_severity, vuln_count, etc.) are kept as real
 * columns for fast SQL aggregate queries without GIN index scans.
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

import { and, eq, gt } from "drizzle-orm";
import { connector_cache } from "../db/schema.js";
import type { DB } from "../db/index.js";
import type {
  ConnectorSnapshot,
  PackageIntelligenceConnector,
  ConnectorResultSummary,
  ConnectorResult,
  VulnerabilitySummary,
  VulnSeverity,
} from "./types.js";

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

function vulnerabilitySummaryFromResult(
  result: ConnectorResult,
): NonNullable<ConnectorResultSummary["vulnerability"]> {
  const legacyResult = isLegacyVulnerabilityResult(result) ? result : null;
  return (
    result.summary?.vulnerability ?? {
      maxSeverity: legacyResult?.maxSeverity ?? "NONE",
      findingCount: legacyResult?.vulnCount ?? result.findings.length,
      fixAvailable: legacyResult?.fixAvailable ?? false,
      bestFixVersion: legacyResult?.bestFixVersion ?? null,
      ...(legacyResult?.severityCounts
        ? { severityCounts: legacyResult.severityCounts }
        : {}),
    }
  );
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

// ---------------------------------------------------------------------------
// Return shape for buildCachedSnapshot.
// `findings` carries the per-finding rows so check-service can upsert
// project_findings on cache hits — the same upsert path as fresh fetches.
// ---------------------------------------------------------------------------
export interface CachedSnapshotResult {
  snapshot: ConnectorSnapshot;
  findings: { finding_id: string; severity: string; title: string | null }[];
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
  ecosystem: string,
  pkg: string,
  version: string,
): Promise<CachedSnapshotResult | null> {
  if (connector.id === "contributor") {
    return null;
  }

  // Fetch the row without a TTL filter — TTL is checked in TypeScript using
  // the per-row ttl_seconds when present, falling back to the connector's
  // global cacheTtlSeconds. This lets connectors store age-based TTLs per row.
  const rows = await db
    .select()
    .from(connector_cache)
    .where(
      and(
        eq(connector_cache.connector_id, connector.id),
        eq(connector_cache.ecosystem, ecosystem),
        eq(connector_cache.package, pkg),
        eq(connector_cache.version, version),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];

  // Staleness check: use the row's own ttl_seconds if set, otherwise fall
  // back to the connector's global config TTL.
  const effectiveTtlSeconds =
    row.ttl_seconds ?? connector.config.cacheTtlSeconds;
  const staleCutoff = new Date(Date.now() - effectiveTtlSeconds * 1000);
  if (row.queried_at <= staleCutoff) return null;
  const cacheAgeHours =
    (Date.now() - row.queried_at.getTime()) / (1000 * 60 * 60);
  const cacheData = (row.data ?? {
    score_model_version: "1.0",
    findings: [],
  }) as CacheData;
  const findings = cacheData.findings ?? [];

  // Contributor rows created under the old "synthetic zero" behavior had no
  // findings payload at all. Treat them as cache misses so the connector can
  // now surface an explicit unavailable snapshot instead of a fake clean score.
  if (connector.id === "contributor" && findings.length === 0) return null;

  // If aggregate says there are vulns but findings array is empty, treat as
  // cache miss so a fresh fetch repopulates data correctly.
  if (row.vuln_count > 0 && findings.length === 0) return null;

  const severityCounts = {
    critical: findings.filter((f) => f.severity === "CRITICAL").length,
    high: findings.filter((f) => f.severity === "HIGH").length,
    medium: findings.filter((f) => f.severity === "MEDIUM").length,
    low: findings.filter((f) => f.severity === "LOW").length,
  };

  const result: ConnectorResult = {
    summary: cacheData.summary ?? {
      vulnerability: {
        maxSeverity: row.max_severity as VulnerabilitySummary["maxSeverity"],
        findingCount: row.vuln_count,
        fixAvailable: row.fix_available,
        bestFixVersion: row.best_fix_version,
        severityCounts,
      },
    },
    findings: findings.map((finding) => ({
      findingId: finding.id,
      severity: finding.severity as VulnerabilitySummary["maxSeverity"],
      title: finding.title,
      publishedAt: finding.published_at ? new Date(finding.published_at) : null,
      attributes: finding.attributes,
    })),
  };

  return {
    snapshot: connector.normalizeToSnapshot(result, {
      ecosystem,
      pkg,
      version,
      isCacheHit: true,
      responseTimeMs: 0,
      cacheAgeHours,
    }),
    findings: findings.map((f) => ({
      finding_id: f.id,
      severity: f.severity,
      title: f.title,
    })),
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
  ecosystem: string,
  pkg: string,
  version: string,
): Promise<ConnectorResult | null> {
  const staleCutoff = new Date(
    Date.now() - connector.config.cacheTtlSeconds * 1000,
  );

  const rows = await db
    .select()
    .from(connector_cache)
    .where(
      and(
        eq(connector_cache.connector_id, connector.id),
        eq(connector_cache.ecosystem, ecosystem),
        eq(connector_cache.package, pkg),
        eq(connector_cache.version, version),
        gt(connector_cache.queried_at, staleCutoff),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    summary: {
      vulnerability: {
        maxSeverity: row.max_severity as VulnerabilitySummary["maxSeverity"],
        findingCount: row.vuln_count,
        fixAvailable: row.fix_available,
        bestFixVersion: row.best_fix_version,
      },
    },
    findings: [],
  };
}

// ---------------------------------------------------------------------------
// upsertCachedResult
// Writes the full connector result into connector_cache — aggregate columns
// and data JSONB in a single upsert. No child table operations.
// ---------------------------------------------------------------------------
export async function upsertCachedResult(
  db: DB,
  connector: PackageIntelligenceConnector,
  ecosystem: string,
  pkg: string,
  version: string,
  result: ConnectorResult,
  /** Explicit TTL override. Falls back to result.ttlSeconds, then null (= use connector config). */
  ttlSeconds?: number,
): Promise<void> {
  // Per-row TTL: explicit arg wins, then result hint, then null (connector config used at read time).
  const effectiveTtl = ttlSeconds ?? result.ttlSeconds ?? undefined;
  const vulnerability = vulnerabilitySummaryFromResult(result);
  const data: CacheData = {
    score_model_version: "1.0",
    ...(result.summary
      ? { summary: result.summary }
      : { summary: { vulnerability } }),
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
      ecosystem,
      package: pkg,
      version,
      max_severity: vulnerability.maxSeverity,
      vuln_count: vulnerability.findingCount,
      fix_available: vulnerability.fixAvailable,
      best_fix_version: vulnerability.bestFixVersion,
      data,
      ttl_seconds: effectiveTtl ?? null,
      queried_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        connector_cache.connector_id,
        connector_cache.ecosystem,
        connector_cache.package,
        connector_cache.version,
      ],
      set: {
        max_severity: vulnerability.maxSeverity,
        vuln_count: vulnerability.findingCount,
        fix_available: vulnerability.fixAvailable,
        best_fix_version: vulnerability.bestFixVersion,
        data,
        ttl_seconds: effectiveTtl ?? null,
        queried_at: new Date(),
      },
    });
}

// ---------------------------------------------------------------------------
// upsertCachedResultWithFindings — preferred exported name for generic
// connector result caching.
// ---------------------------------------------------------------------------
export const upsertCachedResultWithFindings = upsertCachedResult;
