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
  requireProjectAccess: vi.fn(async (c: any) => ({
    projectId: c.req.param("project_id"),
    project: { id: c.req.param("project_id"), tenant_id: c.get("tenantId") },
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

vi.mock("../../connectors/runtime.js", () => ({
  getConnectors: vi.fn(),
}));

vi.mock("../../features/security/connector-sync-service.js", () => ({
  loadConnectorSyncCooldown: vi.fn(),
  runProjectConnectorSync: vi.fn(),
}));

vi.mock("../../features/security/connector-sync-selection.js", () => ({
  selectProjectPackagesForSync: vi.fn(),
}));

import { Hono } from "hono";
import { projectSecurityConnectorRouter } from "../../features/security/connector-routes.js";
import { getConnectors } from "../../connectors/runtime.js";
import {
  loadConnectorSyncCooldown,
  runProjectConnectorSync,
} from "../../features/security/connector-sync-service.js";
import { selectProjectPackagesForSync } from "../../features/security/connector-sync-selection.js";
import {
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
  app.route("/", projectSecurityConnectorRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getConnectors).mockReturnValue([{ id: "osv" }] as any);
  vi.mocked(loadConnectorSyncCooldown).mockResolvedValue(null);
  vi.mocked(selectProjectPackagesForSync).mockResolvedValue([
    { ecosystem: "npm", name: "lodash", version: "4.17.15" },
  ] as any);
  vi.mocked(runProjectConnectorSync).mockResolvedValue({
    synced: 1,
    scheduled: 0,
  } as any);
});

describe("projectSecurityConnectorRouter", () => {
  it("rejects invalid connector keys", async () => {
    const res = await buildApp().request(
      `/v1/projects/${TEST_PROJECT_ID}/connectors/not-valid!/sync`,
      { method: "POST" },
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("rejects callers without connector write access", async () => {
    const res = await buildApp(false).request(
      `/v1/projects/${TEST_PROJECT_ID}/connectors/osv/sync`,
      { method: "POST" },
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("returns 404 when the connector is unavailable", async () => {
    vi.mocked(getConnectors).mockReturnValue([] as any);

    const res = await buildApp().request(
      `/v1/projects/${TEST_PROJECT_ID}/connectors/osv/sync`,
      { method: "POST" },
    );

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("returns retry metadata when the sync is cooling down", async () => {
    vi.mocked(loadConnectorSyncCooldown).mockResolvedValueOnce(45);

    const res = await buildApp().request(
      `/v1/projects/${TEST_PROJECT_ID}/connectors/osv/sync`,
      { method: "POST" },
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("45");
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
  });

  it("runs a connector sync for the selected packages", async () => {
    const res = await buildApp().request(
      `/v1/projects/${TEST_PROJECT_ID}/connectors/osv/sync?scope=vulnerable`,
      { method: "POST" },
    );

    expect(res.status).toBe(200);
    expect(selectProjectPackagesForSync).toHaveBeenCalledWith(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      "osv",
      "vulnerable",
    );
    expect(runProjectConnectorSync).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TEST_TENANT_ID,
        projectId: TEST_PROJECT_ID,
        connectorKey: "osv",
        packagesToSync: [
          { ecosystem: "npm", name: "lodash", version: "4.17.15" },
        ],
      }),
    );
    expect(await res.json()).toEqual({ synced: 1, scheduled: 0 });
  });
});
