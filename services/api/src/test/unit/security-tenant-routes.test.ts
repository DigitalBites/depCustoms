import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    requestBodyLimitBytes: 1048576,
    corsOrigins: ["http://localhost:3001"],
    authUrl: "http://api.local",
    authProxyEnabled: false,
    gotrueUrl: "http://gotrue.local",
    gotrueServiceRoleKey: "service-role-key",
    environment: "test",
    logLevel: "info",
  },
}));

vi.mock("../../http/guards.js", () => ({
  listAccessibleProjectIds: vi.fn(async () => ["p-1", "p-2"]),
  requireTenantCapabilityAccess: (
    c: any,
    _capability: string,
    message = "Access denied",
  ) => {
    if (!c.get("capabilityAllowed")) {
      return {
        ok: false,
        response: c.json(
          { error: { code: "FORBIDDEN", message, detail: null } },
          403,
        ),
      };
    }
    return { ok: true, value: c.req.param("tenant_id") };
  },
}));

vi.mock("../../features/security/tenant-package-shared.js", () => ({
  listTenantVulnerablePackages: vi.fn(),
  loadTenantPackageContext: vi.fn(),
  loadTenantOsvSummary: vi.fn(),
}));

vi.mock("../../features/security/contributor-package-list-queries.js", () => ({
  listTenantContributorPackages: vi.fn(),
  listTenantContributorPackageProjects: vi.fn(),
}));

vi.mock("../../features/security/tenant-security-summary-query.js", () => ({
  loadTenantSecuritySummaryRow: vi.fn(),
}));

import { Hono } from "hono";
import { tenantSecurityPackageRouter } from "../../features/security/tenant-package-routes.js";
import { tenantContributorPackageListRouter } from "../../features/security/tenant-contributor-package-routes.js";
import { tenantSecuritySummaryRouter } from "../../features/security/tenant-summary-routes.js";
import { tenantSecurityPageSummaryRouter } from "../../features/security/tenant-security-summary-routes.js";
import {
  listTenantVulnerablePackages,
  loadTenantPackageContext,
  loadTenantOsvSummary,
} from "../../features/security/tenant-package-shared.js";
import {
  listTenantContributorPackageProjects,
  listTenantContributorPackages,
} from "../../features/security/contributor-package-list-queries.js";
import { loadTenantSecuritySummaryRow } from "../../features/security/tenant-security-summary-query.js";
import { TEST_TENANT_ID } from "../helpers/fakes.js";

function buildApp(router: Hono, capabilityAllowed = true) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("capabilityAllowed", capabilityAllowed);
    await next();
  });
  app.route("/", router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listTenantVulnerablePackages).mockResolvedValue({
    vulnPackages: [
      {
        packageId: "pkg-1",
        packageVersionId: "pkgver-1",
        cacheId: "cache-1",
        ecosystem: "npm",
        name: "lodash",
        version: "4.17.15",
        versionPublishedAt: "2026-04-01T00:00:00Z",
        maxSeverity: "HIGH",
        vulnCount: 2,
        fixAvailable: true,
        bestFixVersion: "4.17.21",
        latestVersion: "4.17.21",
        latestVersionPublishedAt: "2026-04-10T00:00:00Z",
        lastPulledAt: "2026-04-12T00:00:00Z",
      },
    ],
    total: 1,
  } as any);
  vi.mocked(loadTenantPackageContext).mockResolvedValue({
    cacheFindings: [
      {
        cacheId: "cache-1",
        findingId: "CVE-1",
        severity: "HIGH",
        title: "Bad vuln",
        publishedAt: new Date("2026-04-01T00:00:00Z"),
        attributes: { attack_vector: "NETWORK" },
      },
    ],
    violationCountRows: [{ packageVersionId: "pkgver-1", count: "2" }],
    packageProjects: [
      { packageId: "pkg-1", projectId: "p-1", projectName: "Alpha" },
    ],
  } as any);
  vi.mocked(listTenantContributorPackages).mockResolvedValue({
    packages: [
      {
        package_id: "pkg-1",
        ecosystem: "npm",
        name: "lodash",
        version: "4.17.15",
        version_published_at: "2026-04-01T00:00:00Z",
        latest_version: "4.17.21",
        score: 82,
        score_tier: "HIGH",
        publisher: "alice",
        publisher_seen_before_package: false,
        publisher_seen_count_before: 0,
        publisher_matches_prior_version: false,
        maintainer_set_changed: true,
        new_maintainer_count: 1,
        removed_maintainer_count: 0,
        maintainer_count: 2,
        has_install_scripts: true,
        has_provenance: true,
        has_trusted_publisher: false,
        release_velocity_7d: 2,
        release_velocity_30d: 3,
        history_complete: true,
        raw_factors: { publisher_changed: 20 },
        last_scored_at: "2026-04-02T00:00:00Z",
        last_pulled_at: "2026-04-03T00:00:00Z",
      },
    ],
    total: 1,
  } as any);
  vi.mocked(listTenantContributorPackageProjects).mockResolvedValue([
    { package_id: "pkg-1", project_id: "p-1", project_name: "Alpha" },
  ] as any);
  vi.mocked(loadTenantOsvSummary).mockResolvedValue({
    summary: {
      total_packages: "4",
      unscanned_count: "1",
      clean_count: "1",
      critical_count: "1",
      high_count: "1",
      medium_count: "0",
      low_count: "1",
      fixable_count: "2",
      network_exploitable_count: "1",
      oldest_crit_high_advisory: "2026-04-10T00:00:00Z",
    },
    rawLastSynced: "2026-04-18T00:00:00Z",
    fixNotAppliedSet: new Set(["npm|lodash|4.17.15"]),
  } as any);
  vi.mocked(loadTenantSecuritySummaryRow).mockResolvedValue({
    open_count: "5",
    suppressed_count: "2",
    critical_open_count: "1",
    high_open_count: "2",
    medium_open_count: "1",
    low_open_count: "1",
    oldest_open_at: new Date("2026-04-15T00:00:00Z"),
    blocks_30d: "8",
    blocks_7d: "3",
    blocks_prior_7d: "1",
    suppressions_count: "4",
    last_synced_at: new Date("2026-04-18T00:00:00Z"),
    new_findings: 2,
    synced_count: 7,
  } as any);
});

describe("tenant security routes", () => {
  it("returns tenant OSV package listings with package context", async () => {
    const res = await buildApp(tenantSecurityPackageRouter).request(
      `/v1/tenants/${TEST_TENANT_ID}/connectors/osv/packages?offset=0&limit=10`,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination).toEqual({ total: 1, offset: 0, limit: 10 });
    expect(body.packages[0]).toEqual(
      expect.objectContaining({
        name: "lodash",
        openViolationCount: 2,
        projects: [{ id: "p-1", name: "Alpha" }],
      }),
    );
  });

  it("returns tenant contributor packages with project mappings", async () => {
    const res = await buildApp(tenantContributorPackageListRouter).request(
      `/v1/tenants/${TEST_TENANT_ID}/connectors/contributor/packages?score_tier=HIGH&limit=5&offset=0`,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        packages: [
          expect.objectContaining({
            name: "lodash",
            publisher: "alice",
            projects: [{ id: "p-1", name: "Alpha" }],
          }),
        ],
      }),
    );
  });

  it("returns tenant OSV summary", async () => {
    const res = await buildApp(tenantSecuritySummaryRouter).request(
      `/v1/tenants/${TEST_TENANT_ID}/connectors/osv/summary`,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBe(TEST_TENANT_ID);
    expect(body.packages).toEqual({
      total: 4,
      unscanned: 1,
      clean: 1,
      vulnerable: 3,
      bySeverity: { critical: 1, high: 1, medium: 0, low: 1 },
    });
    expect(body.fixes.availableNotApplied).toBe(1);
  });

  it("returns tenant page security summary", async () => {
    const res = await buildApp(tenantSecurityPageSummaryRouter).request(
      `/v1/tenants/${TEST_TENANT_ID}/security-summary`,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        tenantId: TEST_TENANT_ID,
        findings: expect.objectContaining({
          open: 5,
          suppressed: 2,
          bySeverity: { critical: 1, high: 2, medium: 1, low: 1 },
        }),
        violations: { blocks30d: 8, blocks7d: 3, trend7d: 2 },
        suppressions: 4,
      }),
    );
  });
});
