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
}));

vi.mock("../../features/security/package-list-queries.js", () => ({
  listLegacyProjectVulnerablePackages: vi.fn(),
}));

import { Hono } from "hono";
import { db } from "../../db/index.js";
import { projectSecurityPackageLegacyRouter } from "../../features/security/package-legacy-routes.js";
import { listLegacyProjectVulnerablePackages } from "../../features/security/package-list-queries.js";
import {
  q,
  TEST_PROJECT_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
} from "../helpers/fakes.js";

function buildApp(capabilityAllowed = true) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenantId", TEST_TENANT_ID);
    c.set("userId", TEST_USER_ID);
    c.set("role", "owner");
    c.set("capabilityAllowed", capabilityAllowed);
    await next();
  });
  app.route("/", projectSecurityPackageLegacyRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listLegacyProjectVulnerablePackages).mockResolvedValue({
    vulnPackages: [],
    total: 0,
  } as any);
  vi.mocked(db.select).mockReturnValue(q([]) as any);
});

describe("projectSecurityPackageLegacyRouter", () => {
  it("returns an empty legacy vulnerable package page", async () => {
    const res = await buildApp().request(
      `/v1/projects/${TEST_PROJECT_ID}/vulnerable-packages?offset=3&limit=5`,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      packages: [],
      pagination: { total: 0, offset: 3, limit: 5 },
    });
  });

  it("returns legacy vulnerable package responses with network exploitability", async () => {
    vi.mocked(listLegacyProjectVulnerablePackages).mockResolvedValueOnce({
      vulnPackages: [
        {
          cacheId: "cache-1",
          ecosystem: "npm",
          name: "lodash",
          version: "4.17.15",
          osvMaxSeverity: "HIGH",
          osvFindingCount: 2,
          osvFixAvailable: true,
          osvBestFixVersion: "4.17.21",
          lastPulledAt: new Date("2026-04-02T00:00:00Z"),
        },
      ],
      total: 1,
    } as any);
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        {
          id: "cache-1",
          data: {
            findings: [
              {
                id: "OSV-1",
                title: "Prototype pollution",
                severity: "HIGH",
                published_at: "2026-03-20T00:00:00Z",
                attributes: {
                  attack_vector: "NETWORK",
                  fix_version: "4.17.21",
                  aliases: ["CVE-123"],
                  cwe_ids: ["CWE-79"],
                  cvss_v3_score: "7.5",
                },
              },
            ],
          },
        },
      ]) as any,
    );

    const res = await buildApp().request(
      `/v1/projects/${TEST_PROJECT_ID}/vulnerable-packages`,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.packages[0]).toEqual(
      expect.objectContaining({
        ecosystem: "npm",
        name: "lodash",
        networkExploitable: true,
        lastPulledAt: "2026-04-02T00:00:00.000Z",
      }),
    );
    expect(body.packages[0].vulns[0]).toEqual(
      expect.objectContaining({
        osvId: "OSV-1",
        attackVector: "NETWORK",
        fixVersion: "4.17.21",
        aliases: ["CVE-123"],
        cweIds: ["CWE-79"],
        cvssV3Score: 7.5,
      }),
    );
  });
});
