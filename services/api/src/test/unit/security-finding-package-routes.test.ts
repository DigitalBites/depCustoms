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
  getAuthContext: (c: any) => ({
    tenantId: c.get("tenantId"),
    userId: c.get("userId"),
    role: c.get("role"),
  }),
  requireProjectAccess: vi.fn(async (c: any) => ({
    projectId: c.req.param("project_id"),
    project: { id: c.req.param("project_id") },
  })),
  requireTenantCapability: (
    c: any,
    _capability: string,
    message = "Access denied",
  ) => {
    if (!c.get("capabilityAllowed")) {
      c.res = c.json(
        { error: { code: "FORBIDDEN", message, detail: null } },
        403,
      );
      return false;
    }
    return true;
  },
  requireTenantCapabilityAccess: (
    c: any,
    _capability: string,
    message = "Access denied",
  ) => {
    if (!c.get("capabilityAllowed")) {
      c.res = c.json(
        { error: { code: "FORBIDDEN", message, detail: null } },
        403,
      );
      return null;
    }
    const tenantId = c.req.param("tenant_id");
    if (tenantId !== c.get("tenantId")) {
      c.res = c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Access denied to this tenant",
            detail: null,
          },
        },
        403,
      );
      return null;
    }
    return tenantId;
  },
}));

vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("../../features/security/finding-package-queries.js", () => ({
  listProjectFindingPackages: vi.fn(),
  listTenantFindingPackages: vi.fn(),
  listTenantFindingPackageProjects: vi.fn(),
}));

vi.mock("../../features/security/package-finding-context.js", () => ({
  loadProjectPackageFindingContext: vi.fn(),
}));

vi.mock("../../features/security/tenant-package-shared.js", () => ({
  loadTenantPackageContext: vi.fn(),
}));

import { Hono } from "hono";
import {
  projectSecurityFindingPackageRouter,
  tenantSecurityFindingPackageRouter,
} from "../../features/security/finding-package-routes.js";
import {
  listProjectFindingPackages,
  listTenantFindingPackages,
  listTenantFindingPackageProjects,
} from "../../features/security/finding-package-queries.js";
import { loadProjectPackageFindingContext } from "../../features/security/package-finding-context.js";
import { loadTenantPackageContext } from "../../features/security/tenant-package-shared.js";
import { requireProjectAccess } from "../../http/guards.js";
import {
  TEST_PROJECT_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
} from "../helpers/fakes.js";

function buildProjectApp(role = "owner", capabilityAllowed = true) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenantId", TEST_TENANT_ID);
    c.set("userId", TEST_USER_ID);
    c.set("role", role);
    c.set("capabilityAllowed", capabilityAllowed);
    await next();
  });
  app.route("/", projectSecurityFindingPackageRouter);
  return app;
}

function buildTenantApp(role = "owner", capabilityAllowed = true) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenantId", TEST_TENANT_ID);
    c.set("userId", TEST_USER_ID);
    c.set("role", role);
    c.set("capabilityAllowed", capabilityAllowed);
    await next();
  });
  app.route("/", tenantSecurityFindingPackageRouter);
  return app;
}

function makePackage(overrides: Record<string, unknown> = {}) {
  return {
    package_version_id: "pkgver-1",
    ecosystem: "npm",
    name: "lodash",
    version: "4.17.15",
    version_published_at: "2026-03-01T00:00:00Z",
    last_pulled_at: "2026-04-01T00:00:00Z",
    latest_version: "4.17.21",
    latest_version_published_at: "2026-04-02T00:00:00Z",
    osv_cache_id: "cache-1",
    osv_max_severity: "HIGH",
    osv_vuln_count: "2",
    osv_fix_available: true,
    osv_best_fix_version: "4.17.21",
    contributor_cache_id: "contrib-1",
    contributor_tier: "HIGH",
    contributor_score: "88",
    publisher: "alice",
    publisher_seen_before_package: false,
    publisher_seen_count_before: "0",
    publisher_matches_prior_version: false,
    maintainer_set_changed: true,
    new_maintainer_count: "1",
    removed_maintainer_count: "0",
    maintainer_count: "2",
    has_install_scripts: true,
    has_provenance: true,
    has_trusted_publisher: false,
    release_velocity_7d: "1",
    release_velocity_30d: "3",
    history_complete: false,
    contributor_raw_factors: { publisher: 0.9 },
    contributor_last_scored_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireProjectAccess).mockResolvedValue({
    projectId: TEST_PROJECT_ID,
    project: { id: TEST_PROJECT_ID } as any,
  });
  vi.mocked(listProjectFindingPackages).mockResolvedValue({
    packages: [],
    total: 0,
  } as any);
  vi.mocked(listTenantFindingPackages).mockResolvedValue({
    packages: [],
    total: 0,
  } as any);
  vi.mocked(listTenantFindingPackageProjects).mockResolvedValue([] as any);
  vi.mocked(loadProjectPackageFindingContext).mockResolvedValue({
    cacheFindings: [],
    entityContextRows: [],
  } as any);
  vi.mocked(loadTenantPackageContext).mockResolvedValue({
    cacheFindings: [],
    violationCountRows: [],
  } as any);
});

describe("finding package routes", () => {
  it("returns 403 for project routes when the caller lacks capability", async () => {
    const res = await buildProjectApp("owner", false).request(
      `/v1/projects/${TEST_PROJECT_ID}/findings/packages`,
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns an empty project findings page", async () => {
    const res = await buildProjectApp("member").request(
      `/v1/projects/${TEST_PROJECT_ID}/findings/packages?offset=5&limit=10`,
    );

    expect(res.status).toBe(200);
    expect(listProjectFindingPackages).toHaveBeenCalledWith(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      { offset: 5, limit: 10, includeContributor: true },
    );
    expect(await res.json()).toEqual({
      packages: [],
      pagination: { total: 0, offset: 5, limit: 10 },
    });
  });

  it("returns serialized project findings with contributor data and dispositions", async () => {
    vi.mocked(listProjectFindingPackages).mockResolvedValueOnce({
      packages: [makePackage()],
      total: 1,
    } as any);
    vi.mocked(loadProjectPackageFindingContext).mockResolvedValueOnce({
      cacheFindings: [
        {
          cacheId: "cache-1",
          findingId: "OSV-1",
          severity: "HIGH",
          title: "Prototype pollution",
          publishedAt: new Date("2026-03-15T00:00:00Z"),
          attributes: { attack_vector: "NETWORK" },
        },
      ],
      entityContextRows: [
        {
          entity_id: "npm:lodash:4.17.15",
          dispositions: [{ findingId: "OSV-1", status: "open" }],
          open_violation_count: "3",
        },
      ],
    } as any);

    const res = await buildProjectApp("owner").request(
      `/v1/projects/${TEST_PROJECT_ID}/findings/packages`,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.total).toBe(1);
    expect(body.packages[0]).toEqual(
      expect.objectContaining({
        ecosystem: "npm",
        name: "lodash",
        version: "4.17.15",
        openViolationCount: 3,
        contributor: expect.objectContaining({
          status: "ready",
          hasFinding: true,
          tier: "HIGH",
          score: 88,
        }),
        osv: expect.objectContaining({
          hasFindings: true,
          highestSeverity: "HIGH",
          vulnCount: 2,
          networkExploitable: true,
          findingStatus: "open",
        }),
      }),
    );
    expect(body.packages[0].osv.vulns[0]).toEqual(
      expect.objectContaining({
        findingId: "OSV-1",
        disposition: { findingId: "OSV-1", status: "open" },
      }),
    );
  });

  it("returns an empty tenant findings page", async () => {
    const res = await buildTenantApp("owner").request(
      `/v1/tenants/${TEST_TENANT_ID}/findings/packages?offset=2&limit=4`,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      packages: [],
      pagination: { total: 0, offset: 2, limit: 4 },
    });
  });

  it("returns tenant findings with deduped project associations", async () => {
    vi.mocked(listTenantFindingPackages).mockResolvedValueOnce({
      packages: [makePackage()],
      total: 1,
    } as any);
    vi.mocked(loadTenantPackageContext).mockResolvedValueOnce({
      cacheFindings: [
        {
          cacheId: "cache-1",
          findingId: "OSV-2",
          severity: "HIGH",
          title: "Remote code execution",
          publishedAt: new Date("2026-03-20T00:00:00Z"),
          attributes: {},
        },
      ],
      violationCountRows: [{ entityId: "npm:lodash:4.17.15", count: "2" }],
    } as any);
    vi.mocked(listTenantFindingPackageProjects).mockResolvedValueOnce([
      {
        package_version_id: "pkgver-1",
        project_id: "p-1",
        project_name: "Alpha",
      },
      {
        package_version_id: "pkgver-1",
        project_id: "p-1",
        project_name: "Alpha",
      },
      {
        package_version_id: "pkgver-1",
        project_id: "p-2",
        project_name: "Beta",
      },
    ] as any);

    const res = await buildTenantApp("admin").request(
      `/v1/tenants/${TEST_TENANT_ID}/findings/packages`,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.packages[0]).toEqual(
      expect.objectContaining({
        openViolationCount: 2,
        projects: [
          { id: "p-1", name: "Alpha" },
          { id: "p-2", name: "Beta" },
        ],
        contributor: expect.objectContaining({
          status: "ready",
          score: 88,
        }),
      }),
    );
  });
});
