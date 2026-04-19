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
    return c.req.param("tenant_id");
  },
}));

vi.mock("../../features/security/contributor-package-list-queries.js", () => ({
  listProjectContributorPackages: vi.fn(),
  listTenantContributorPublishers: vi.fn(),
}));

import { Hono } from "hono";
import { projectContributorPackageListRouter } from "../../features/security/contributor-package-list-routes.js";
import { contributorPublisherRouter } from "../../features/security/contributor-publisher-routes.js";
import {
  listProjectContributorPackages,
  listTenantContributorPublishers,
} from "../../features/security/contributor-package-list-queries.js";
import {
  TEST_PROJECT_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
} from "../helpers/fakes.js";

function buildApp(router: Hono, capabilityAllowed = true) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenantId", TEST_TENANT_ID);
    c.set("userId", TEST_USER_ID);
    c.set("role", "owner");
    c.set("capabilityAllowed", capabilityAllowed);
    await next();
  });
  app.route("/", router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listProjectContributorPackages).mockResolvedValue({
    packages: [
      {
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
  vi.mocked(listTenantContributorPublishers).mockResolvedValue({
    publishers: [
      {
        ecosystem: "npm",
        publisher_name: "alice",
        package_count: 2,
        first_time_publisher_count: 1,
        continuity_break_count: 1,
        last_seen_at: "2026-04-05T00:00:00Z",
      },
    ],
    total: 1,
  } as any);
});

describe("contributor route handlers", () => {
  it("returns project contributor packages", async () => {
    const res = await buildApp(projectContributorPackageListRouter).request(
      `/v1/projects/${TEST_PROJECT_ID}/connectors/contributor/packages?score_tier=HIGH&min_score=80&limit=5&offset=1`,
    );

    expect(res.status).toBe(200);
    expect(listProjectContributorPackages).toHaveBeenCalledWith(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      { scoreTier: "HIGH", minScore: 80, limit: 5, offset: 1 },
    );
    expect(await res.json()).toEqual(
      expect.objectContaining({
        packages: [
          expect.objectContaining({
            name: "lodash",
            score: 82,
            publisher: "alice",
            scoreTier: "HIGH",
          }),
        ],
        pagination: { total: 1, offset: 1, limit: 5 },
      }),
    );
  });

  it("blocks project contributor packages without connector capability", async () => {
    const res = await buildApp(
      projectContributorPackageListRouter,
      false,
    ).request(
      `/v1/projects/${TEST_PROJECT_ID}/connectors/contributor/packages`,
    );

    expect(res.status).toBe(403);
    expect(listProjectContributorPackages).not.toHaveBeenCalled();
  });

  it("returns tenant contributor publishers", async () => {
    const res = await buildApp(contributorPublisherRouter).request(
      `/v1/tenants/${TEST_TENANT_ID}/connectors/contributor/publishers?ecosystem=npm&only_first_time=true&limit=10&offset=0`,
    );

    expect(res.status).toBe(200);
    expect(listTenantContributorPublishers).toHaveBeenCalledWith(
      TEST_TENANT_ID,
      {
        ecosystem: "npm",
        onlyFirstTime: true,
        limit: 10,
        offset: 0,
      },
    );
    expect(await res.json()).toEqual({
      publishers: [
        {
          ecosystem: "npm",
          publisherName: "alice",
          packageCount: 2,
          firstTimePublisherCount: 1,
          continuityBreakCount: 1,
          lastSeenAt: "2026-04-05T00:00:00.000Z",
        },
      ],
      pagination: { total: 1, offset: 0, limit: 10 },
    });
  });

  it("rejects invalid contributor publisher pagination", async () => {
    const res = await buildApp(contributorPublisherRouter).request(
      `/v1/tenants/${TEST_TENANT_ID}/connectors/contributor/publishers?limit=0`,
    );

    expect(res.status).toBe(400);
    expect(listTenantContributorPublishers).not.toHaveBeenCalled();
  });
});
