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

import { and, eq, isNull, or } from "drizzle-orm";
import { connector_cache } from "../db/schema.js";
import type { DB } from "../db/index.js";
import {
  resolveArtifactIdentity,
  type ArtifactIdentity,
} from "../features/packages/artifact-identity.js";
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

export const PACKAGE_SCOPE_CACHE_VERSION = "__package__";

type ConnectorCacheIdentity = {
  artifact: ArtifactIdentity;
  cacheVersion: string;
};

async function resolveConnectorCacheIdentity(
  db: DB,
  ecosystem: string,
  pkg: string,
  version: string,
): Promise<ConnectorCacheIdentity> {
  const artifact = await resolveArtifactIdentity(db, {
    ecosystem,
    package: pkg,
    version: version === PACKAGE_SCOPE_CACHE_VERSION ? null : version,
    source: "connector_cache",
  });

  return {
    artifact,
    cacheVersion: artifact.version ?? PACKAGE_SCOPE_CACHE_VERSION,
  };
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

type CacheRow = typeof connector_cache.$inferSelect;

type CacheInterpretationOptions = {
  includeFindings: boolean;
  treatEmptyContributorFindingsAsMiss?: boolean;
  treatBrokenFindingStateAsMiss?: boolean;
};

async function findFreshCacheRow(
  db: DB,
  connector: PackageIntelligenceConnector,
  identity: ConnectorCacheIdentity,
): Promise<CacheRow | null> {
  const normalizedKey = and(
    eq(connector_cache.ecosystem, identity.artifact.ecosystem),
    eq(connector_cache.package, identity.artifact.package),
    eq(connector_cache.version, identity.cacheVersion),
  );
  const normalizedIdKey = identity.artifact.package_version_id
    ? eq(connector_cache.package_version_id, identity.artifact.package_version_id)
    : identity.artifact.package_id &&
        identity.cacheVersion === PACKAGE_SCOPE_CACHE_VERSION
      ? and(
          eq(connector_cache.package_id, identity.artifact.package_id),
          isNull(connector_cache.package_version_id),
          eq(connector_cache.version, PACKAGE_SCOPE_CACHE_VERSION),
        )
      : undefined;

  const rows = await db
    .select()
    .from(connector_cache)
    .where(
      and(
        eq(connector_cache.connector_id, connector.id),
        normalizedIdKey ? or(normalizedIdKey, normalizedKey) : normalizedKey,
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
    options.treatEmptyContributorFindingsAsMiss &&
    row.connector_id === "contributor" &&
    findings.length === 0
  ) {
    return null;
  }

  if (
    options.treatBrokenFindingStateAsMiss &&
    row.vuln_count > 0 &&
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
        vulnerability: {
          maxSeverity: row.max_severity as VulnerabilitySummary["maxSeverity"],
          findingCount: row.vuln_count,
          fixAvailable: row.fix_available,
          bestFixVersion: row.best_fix_version,
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
  ecosystem: string,
  pkg: string,
  version: string,
): Promise<CachedSnapshotResult | null> {
  if (connector.id === "contributor") {
    return null;
  }

  const identity = await resolveConnectorCacheIdentity(
    db,
    ecosystem,
    pkg,
    version,
  );
  const row = await findFreshCacheRow(
    db,
    connector,
    identity,
  );
  if (!row) return null;

  const interpreted = interpretCacheRow(row, {
    includeFindings: true,
    treatBrokenFindingStateAsMiss: true,
  });
  if (!interpreted) return null;

  return {
    snapshot: connector.normalizeToSnapshot(interpreted.result, {
      ecosystem: identity.artifact.ecosystem,
      pkg: identity.artifact.package,
      version: identity.cacheVersion,
      isCacheHit: true,
      responseTimeMs: 0,
      cacheAgeHours: interpreted.cacheAgeHours,
    }),
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
  ecosystem: string,
  pkg: string,
  version: string,
): Promise<ConnectorResult | null> {
  const identity = await resolveConnectorCacheIdentity(
    db,
    ecosystem,
    pkg,
    version,
  );
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
  ecosystem: string,
  pkg: string,
): Promise<ConnectorResult | null> {
  const identity = await resolveConnectorCacheIdentity(
    db,
    ecosystem,
    pkg,
    PACKAGE_SCOPE_CACHE_VERSION,
  );
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
  const identity = await resolveConnectorCacheIdentity(
    db,
    ecosystem,
    pkg,
    version,
  );
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
      ecosystem: identity.artifact.ecosystem,
      package: identity.artifact.package,
      version: identity.cacheVersion,
      package_id: identity.artifact.package_id,
      package_version_id: identity.artifact.package_version_id,
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
        package_id: identity.artifact.package_id,
        package_version_id: identity.artifact.package_version_id,
        vuln_count: vulnerability.findingCount,
        fix_available: vulnerability.fixAvailable,
        best_fix_version: vulnerability.bestFixVersion,
        data,
        ttl_seconds: effectiveTtl ?? null,
        queried_at: new Date(),
      },
    });
}

export async function upsertPackageScopedCachedResult(
  db: DB,
  connector: PackageIntelligenceConnector,
  ecosystem: string,
  pkg: string,
  result: ConnectorResult,
  ttlSeconds?: number,
): Promise<void> {
  return upsertCachedResult(
    db,
    connector,
    ecosystem,
    pkg,
    PACKAGE_SCOPE_CACHE_VERSION,
    result,
    ttlSeconds,
  );
}

// ---------------------------------------------------------------------------
// upsertCachedResultWithFindings — preferred exported name for generic
// connector result caching.
// ---------------------------------------------------------------------------
export const upsertCachedResultWithFindings = upsertCachedResult;
