import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCachedSnapshot,
  getCachedResult,
  getPackageScopedCachedResult,
  upsertCachedResult,
} from "../../connectors/cache.js";

function makeDb() {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  } as any;
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockImplementation(async () => []);

  const insertQuery = {
    values: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    returning: vi.fn(),
  } as any;
  insertQuery.values.mockReturnValue(insertQuery);
  insertQuery.onConflictDoUpdate.mockReturnValue(insertQuery);
  insertQuery.returning.mockResolvedValue([]);

  return {
    select: vi.fn(() => query),
    insert: vi.fn(() => insertQuery),
    query,
    insertQuery,
  };
}

const connector = {
  id: "osv",
  config: {
    cacheTtlSeconds: 300,
    responseTimeoutMs: 1000,
    backgroundTimeoutMs: 1000,
  },
  normalizeToSnapshot: vi.fn((_result, context) => ({
    connectorKey: "osv",
    entityType: "artifact",
    packageId: context.packageId,
    packageVersionId: context.packageVersionId,
    ecosystem: context.ecosystem,
    packageName: context.pkg,
    version: context.version,
    displayName: context.displayName,
    fields: { risk_tier: "HIGH" },
    meta: {
      status: context.isCacheHit ? "cache_hit" : "ok",
      responseTimeMs: context.responseTimeMs,
      cacheAgeHours: context.cacheAgeHours,
      isCacheHit: context.isCacheHit,
    },
    observedAt: new Date().toISOString(),
  })),
} as any;

function artifactEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    kind: "artifact_request",
    packageId: "pkg-npm-lodash",
    packageVersionId: "pkgver-npm-lodash-4.17.15",
    ecosystem: "npm",
    packageName: "lodash",
    version: "4.17.15",
    source: "proxy",
    observedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  } as any;
}

function packageEvent(overrides: Record<string, unknown> = {}) {
  return artifactEvent({
    kind: "package_metadata",
    packageVersionId: null,
    version: null,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("connector cache helpers", () => {
  it("returns null on cache miss", async () => {
    const db = makeDb();
    const result = await buildCachedSnapshot(
      db as any,
      connector,
      artifactEvent(),
      "npm:lodash@4.17.15",
    );
    expect(result).toBeNull();
  });

  it("returns null for stale cache rows", async () => {
    const db = makeDb();
    db.query.limit.mockResolvedValueOnce([
      {
        connector_id: "osv",
        queried_at: new Date(Date.now() - 10 * 60 * 1000),
        ttl_seconds: 60,
        finding_count: 1,
        risk_tier: "HIGH",
        remediation_available: true,
        best_remediation: "4.17.21",
        data: {
          score_model_version: "1.0",
          summary: {
            vulnerability: {
              maxSeverity: "HIGH",
              findingCount: 1,
              fixAvailable: true,
              bestFixVersion: "4.17.21",
              severityCounts: {
                critical: 0,
                high: 1,
                medium: 0,
                low: 0,
              },
            },
          },
          findings: [
            {
              id: "OSV-1",
              severity: "HIGH",
              title: "Issue",
              published_at: null,
              attributes: {},
            },
          ],
        },
      },
    ]);

    const result = await buildCachedSnapshot(
      db as any,
      connector,
      artifactEvent(),
      "npm:lodash@4.17.15",
    );
    expect(result).toBeNull();
  });

  it("builds a cached snapshot and findings list from a fresh row", async () => {
    const db = makeDb();
    db.query.limit.mockResolvedValueOnce([
      {
        connector_id: "osv",
        queried_at: new Date(Date.now() - 30 * 1000),
        ttl_seconds: 300,
        finding_count: 1,
        risk_tier: "HIGH",
        remediation_available: true,
        best_remediation: "4.17.21",
        data: {
          score_model_version: "1.0",
          findings: [
            {
              id: "OSV-1",
              severity: "HIGH",
              title: "Issue",
              published_at: "2026-04-01T00:00:00Z",
              attributes: { attack_vector: "NETWORK" },
            },
          ],
        },
      },
    ]);

    const result = await buildCachedSnapshot(
      db as any,
      connector,
      artifactEvent(),
      "npm:lodash@4.17.15",
    );
    expect(result?.findings).toEqual([
      { finding_id: "OSV-1", severity: "HIGH", title: "Issue" },
    ]);
    expect(result?.snapshot).toEqual(
      expect.objectContaining({
        connectorKey: "osv",
        packageId: "pkg-npm-lodash",
        packageVersionId: "pkgver-npm-lodash-4.17.15",
        displayName: "npm:lodash@4.17.15",
      }),
    );
    expect(connector.normalizeToSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: {
          risk: {
            tier: "HIGH",
            score: null,
          },
          findings: {
            count: 1,
          },
          remediation: {
            available: true,
            best: "4.17.21",
          },
          vulnerability: {
            maxSeverity: "HIGH",
            findingCount: 1,
            fixAvailable: true,
            bestFixVersion: "4.17.21",
            severityCounts: {
              critical: 0,
              high: 1,
              medium: 0,
              low: 0,
            },
          },
        },
      }),
      expect.any(Object),
    );
  });

  it("treats broken rows with finding_count but no findings as cache misses", async () => {
    const db = makeDb();
    db.query.limit.mockResolvedValueOnce([
      {
        connector_id: "osv",
        queried_at: new Date(),
        ttl_seconds: 300,
        finding_count: 2,
        risk_tier: "HIGH",
        remediation_available: true,
        best_remediation: "4.17.21",
        data: { score_model_version: "1.0", findings: [] },
      },
    ]);

    const result = await buildCachedSnapshot(
      db as any,
      connector,
      artifactEvent(),
      "npm:lodash@4.17.15",
    );
    expect(result).toBeNull();
  });

  it("returns a lightweight cached aggregate result", async () => {
    const db = makeDb();
    db.query.limit.mockResolvedValueOnce([
      {
        connector_id: "osv",
        queried_at: new Date(),
        ttl_seconds: 300,
        risk_tier: "MEDIUM",
        finding_count: 2,
        remediation_available: false,
        best_remediation: null,
        data: { score_model_version: "1.0", findings: [] },
      },
    ]);

    const result = await getCachedResult(
      db as any,
      connector,
      artifactEvent(),
    );
    expect(result).toEqual({
      summary: {
        risk: {
          tier: "MEDIUM",
          score: null,
        },
        findings: {
          count: 2,
        },
        remediation: {
          available: false,
          best: null,
        },
        vulnerability: {
          maxSeverity: "MEDIUM",
          findingCount: 2,
          fixAvailable: false,
          bestFixVersion: null,
        },
      },
      findings: [],
    });
  });

  it("uses per-row ttl_seconds for package-scoped cache reads", async () => {
    const db = makeDb();
    db.query.limit.mockResolvedValueOnce([
      {
        connector_id: "osv",
        queried_at: new Date(Date.now() - 10 * 60 * 1000),
        ttl_seconds: 3600,
        finding_count: 1,
        risk_tier: "HIGH",
        remediation_available: true,
        best_remediation: "4.17.21",
        data: {
          score_model_version: "1.0",
          findings: [
            {
              id: "OSV-1",
              severity: "HIGH",
              title: "Issue",
              published_at: null,
              attributes: { attack_vector: "NETWORK" },
            },
          ],
        },
      },
    ]);

    const result = await getPackageScopedCachedResult(
      db as any,
      connector,
      packageEvent(),
    );

    expect(result).toEqual({
      summary: {
        risk: {
          tier: "HIGH",
          score: null,
        },
        findings: {
          count: 1,
        },
        remediation: {
          available: true,
          best: "4.17.21",
        },
        vulnerability: {
          maxSeverity: "HIGH",
          findingCount: 1,
          fixAvailable: true,
          bestFixVersion: "4.17.21",
          severityCounts: {
            critical: 0,
            high: 1,
            medium: 0,
            low: 0,
          },
        },
      },
      findings: [
        {
          findingId: "OSV-1",
          severity: "HIGH",
          title: "Issue",
          publishedAt: null,
          attributes: { attack_vector: "NETWORK" },
        },
      ],
    });
  });

  it("upserts cached results including ttl_seconds and serialized findings", async () => {
    const db = makeDb();
    await upsertCachedResult(
      db as any,
      connector,
      artifactEvent({
        packageId: "pkg-1",
        packageVersionId: "pkgver-1",
      }),
      {
        ttlSeconds: 120,
        summary: {
          vulnerability: {
            maxSeverity: "HIGH",
            findingCount: 1,
            fixAvailable: true,
            bestFixVersion: "4.17.21",
            severityCounts: {
              critical: 0,
              high: 1,
              medium: 0,
              low: 0,
            },
          },
        },
        findings: [
          {
            findingId: "OSV-1",
            severity: "HIGH",
            title: "Issue",
            publishedAt: new Date("2026-04-01T00:00:00Z"),
            attributes: { attack_vector: "NETWORK" },
          },
        ],
      },
    );

    expect(db.insert).toHaveBeenCalled();
    expect(db.insertQuery.values).toHaveBeenLastCalledWith(
      expect.objectContaining({
        connector_id: "osv",
        package_id: "pkg-1",
        package_version_id: "pkgver-1",
        ttl_seconds: 120,
        data: expect.objectContaining({
          summary: {
            vulnerability: {
              maxSeverity: "HIGH",
              findingCount: 1,
              fixAvailable: true,
              bestFixVersion: "4.17.21",
              severityCounts: {
                critical: 0,
                high: 1,
                medium: 0,
                low: 0,
              },
            },
          },
          findings: [
            expect.objectContaining({
              id: "OSV-1",
              published_at: "2026-04-01T00:00:00.000Z",
            }),
          ],
        }),
      }),
    );
  });

  it("uses package-scoped catalog identity for package metadata cache rows", async () => {
    const db = makeDb();
    await upsertCachedResult(
      db as any,
      connector,
      packageEvent({
        packageId: "pkg-pypi-my-pkg",
        packageVersionId: null,
        ecosystem: "pypi",
        packageName: "my-pkg",
        version: null,
      }),
      {
        summary: {
          risk: {
            tier: "NONE",
            score: null,
          },
        },
        findings: [],
      } as any,
    );

    expect(db.insertQuery.values).toHaveBeenLastCalledWith(
      expect.objectContaining({
        package_id: "pkg-pypi-my-pkg",
        package_version_id: null,
      }),
    );

    const conflict = db.insertQuery.onConflictDoUpdate.mock.calls[0][0];
    expect(conflict.target).toHaveLength(2);
    expect(conflict.set).toEqual(
      expect.objectContaining({
        package_id: "pkg-pypi-my-pkg",
        package_version_id: null,
      }),
    );
  });
});
