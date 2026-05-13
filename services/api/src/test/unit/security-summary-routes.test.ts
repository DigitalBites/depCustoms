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

vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("../../http/guards.js", () => ({
  getAuthContext: (c: any) => ({
    tenantId: c.get("tenantId"),
    userId: c.get("userId"),
    role: c.get("role"),
  }),
  listAccessibleProjectIds: vi.fn(async () => null),
  requireProjectAccess: vi.fn(async (c: any) => ({
    ok: true,
    value: {
      projectId: c.req.param("project_id"),
      project: { id: c.req.param("project_id") },
    },
  })),
  requireTenantCapability: (
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
    return { ok: true, value: undefined };
  },
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

vi.mock("../../features/security/project-security-summary-query.js", () => ({
  loadProjectSecuritySummaryRow: vi.fn(),
}));

vi.mock("../../features/security/contributor-package-list-queries.js", () => ({
  loadProjectContributorSummary: vi.fn(),
  loadTenantContributorSummary: vi.fn(),
}));

vi.mock("../../features/security/package-list-queries.js", () => ({
  listProjectVulnerablePackages: vi.fn(),
}));

vi.mock("../../features/security/package-finding-context.js", () => ({
  loadProjectPackageFindingContext: vi.fn(),
}));

import { Hono } from "hono";
import { projectSecuritySummaryRouter } from "../../features/security/summary-routes.js";
import { contributorSummaryRouter } from "../../features/security/contributor-summary-routes.js";
import { projectSecurityPackageListRouter } from "../../features/security/package-list-routes.js";
import { loadProjectSecuritySummaryRow } from "../../features/security/project-security-summary-query.js";
import {
  loadProjectContributorSummary,
  loadTenantContributorSummary,
} from "../../features/security/contributor-package-list-queries.js";
import { listProjectVulnerablePackages } from "../../features/security/package-list-queries.js";
import { loadProjectPackageFindingContext } from "../../features/security/package-finding-context.js";
import { listAccessibleProjectIds } from "../../http/guards.js";
import {
  TEST_PROJECT_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
} from "../helpers/fakes.js";

function buildApp(router: Hono, role = "owner", capabilityAllowed = true) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenantId", TEST_TENANT_ID);
    c.set("userId", TEST_USER_ID);
    c.set("role", role);
    c.set("capabilityAllowed", capabilityAllowed);
    await next();
  });
  app.route("/", router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadProjectSecuritySummaryRow).mockResolvedValue(null as any);
  vi.mocked(loadProjectContributorSummary).mockResolvedValue({
    total_scanned: "4",
    not_scanned_count: "1",
    high_risk_count: "1",
    medium_risk_count: "1",
    low_risk_count: "1",
    clean_count: "1",
    new_maintainer_count: "2",
    first_time_publisher_count: "1",
    publisher_change_count: "1",
    install_scripts_count: "1",
    last_scored_at: "2026-04-01T00:00:00Z",
  } as any);
  vi.mocked(loadTenantContributorSummary).mockResolvedValue({
    summary: {
      total_scanned: "4",
      not_scanned_count: "0",
      high_risk_count: "1",
      medium_risk_count: "1",
      low_risk_count: "1",
      clean_count: "1",
      new_maintainer_count: "2",
      first_time_publisher_count: "1",
      publisher_change_count: "1",
      install_scripts_count: "1",
      last_scored_at: "2026-04-01T00:00:00Z",
    },
    byProject: [
      {
        project_id: "p-1",
        project_name: "Alpha",
        total_scanned: "2",
        high_risk_count: "1",
        medium_risk_count: "0",
        low_risk_count: "1",
        clean_count: "0",
      },
    ],
  } as any);
  vi.mocked(listProjectVulnerablePackages).mockResolvedValue({
    vulnPackages: [],
    total: 0,
  } as any);
  vi.mocked(loadProjectPackageFindingContext).mockResolvedValue({
    cacheFindings: [],
    entityContextRows: [],
  } as any);
  vi.mocked(listAccessibleProjectIds).mockResolvedValue(["p-1", "p-2"] as any);
});

describe("security summary and package list routes", () => {
  it("returns a computed project security summary", async () => {
    vi.mocked(loadProjectSecuritySummaryRow).mockResolvedValueOnce({
      open_count: "5",
      suppressed_count: "2",
      critical_open_count: "1",
      high_open_count: "2",
      medium_open_count: "1",
      low_open_count: "1",
      oldest_open_at: new Date(Date.now() - 3 * 86_400_000),
      blocks_30d: "12",
      blocks_7d: "4",
      blocks_prior_7d: "1",
      suppressions_count: "3",
      last_synced_at: new Date("2026-04-01T00:00:00Z"),
      new_findings: 2,
      synced_count: 7,
    } as any);

    const res = await buildApp(projectSecuritySummaryRouter).request(
      `/v1/projects/${TEST_PROJECT_ID}/security-summary`,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(
      expect.objectContaining({
        projectId: TEST_PROJECT_ID,
        findings: expect.objectContaining({
          open: 5,
          suppressed: 2,
          oldestOpenDays: 3,
          bySeverity: { critical: 1, high: 2, medium: 1, low: 1 },
        }),
        violations: { blocks30d: 12, blocks7d: 4, trend7d: 3 },
        suppressions: 3,
        connectors: {
          osv: {
            lastSyncedAt: "2026-04-01T00:00:00.000Z",
            newFindings: 2,
            syncedCount: 7,
          },
        },
      }),
    );
  });

  it("returns a project contributor summary", async () => {
    const res = await buildApp(contributorSummaryRouter).request(
      `/v1/projects/${TEST_PROJECT_ID}/connectors/contributor/summary`,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projectId).toBe(TEST_PROJECT_ID);
    expect(body.packages).toEqual({
      totalScanned: 4,
      notScanned: 1,
      byRisk: { high: 1, medium: 1, low: 1, clean: 1 },
    });
    expect(body.signals).toEqual({
      newMaintainerCount: 2,
      firstTimePublisherCount: 1,
      publisherChangeCount: 1,
      installScriptsCount: 1,
    });
  });

  it("returns a tenant contributor summary scoped to accessible projects", async () => {
    const res = await buildApp(contributorSummaryRouter, "member").request(
      `/v1/tenants/${TEST_TENANT_ID}/connectors/contributor/summary`,
    );

    expect(res.status).toBe(200);
    expect(loadTenantContributorSummary).toHaveBeenCalledWith(TEST_TENANT_ID, [
      "p-1",
      "p-2",
    ]);
    const body = await res.json();
    expect(body.tenantId).toBe(TEST_TENANT_ID);
    expect(body.byProject).toEqual([
      {
        projectId: "p-1",
        projectName: "Alpha",
        totalScanned: 2,
        byRisk: { high: 1, medium: 0, low: 1, clean: 0 },
      },
    ]);
  });

  it("returns an empty project OSV package page", async () => {
    const res = await buildApp(projectSecurityPackageListRouter).request(
      `/v1/projects/${TEST_PROJECT_ID}/connectors/osv/packages?offset=1&limit=2`,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      packages: [],
      pagination: { total: 0, offset: 1, limit: 2 },
    });
  });

  it("returns serialized vulnerable packages for a project", async () => {
    vi.mocked(listProjectVulnerablePackages).mockResolvedValueOnce({
      vulnPackages: [
        {
          packageId: "pkg-1",
          packageVersionId: "pkgver-1",
          cacheId: "cache-1",
          ecosystem: "npm",
          name: "lodash",
          version: "4.17.15",
          versionPublishedAt: "2026-03-01T00:00:00Z",
          osvMaxSeverity: "HIGH",
          osvFindingCount: 2,
          osvFixAvailable: true,
          osvBestFixVersion: "4.17.21",
          latestVersion: "4.17.21",
          latestVersionPublishedAt: "2026-04-01T00:00:00Z",
          lastPulledAt: "2026-04-05T00:00:00Z",
        },
      ],
      total: 1,
    } as any);
    vi.mocked(loadProjectPackageFindingContext).mockResolvedValueOnce({
      cacheFindings: [
        {
          cacheId: "cache-1",
          findingId: "OSV-1",
          severity: "HIGH",
          title: "Prototype pollution",
          publishedAt: new Date("2026-03-10T00:00:00Z"),
          attributes: { attack_vector: "NETWORK" },
        },
      ],
      entityContextRows: [
        {
          package_version_id: "pkgver-1",
          dispositions: [{ findingId: "OSV-1", observationStatus: "observed" }],
          open_violation_count: "2",
        },
      ],
    } as any);

    const res = await buildApp(projectSecurityPackageListRouter).request(
      `/v1/projects/${TEST_PROJECT_ID}/connectors/osv/packages`,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.packages[0]).toEqual(
      expect.objectContaining({
        ecosystem: "npm",
        name: "lodash",
        maxSeverity: "HIGH",
        vulnCount: 2,
        openViolationCount: 2,
        networkExploitable: true,
        observationStatus: "observed",
      }),
    );
    expect(body.packages[0].vulns[0]).toEqual(
      expect.objectContaining({
        findingId: "OSV-1",
        disposition: { findingId: "OSV-1", observationStatus: "observed" },
      }),
    );
  });
});
