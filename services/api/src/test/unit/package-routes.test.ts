import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    environment: "test",
  },
}));

vi.mock("../../db/index.js", () => ({
  db: {
    delete: vi.fn(),
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

vi.mock("../../features/packages/shared.js", () => ({
  listProjectPackages: vi.fn(),
  rebuildProjectPackages: vi.fn(),
}));

import { Hono } from "hono";
import { db } from "../../db/index.js";
import { projectPackagesRouter } from "../../features/packages/project-routes.js";
import { packageRebuildRouter } from "../../features/packages/rebuild-routes.js";
import {
  listProjectPackages,
  rebuildProjectPackages,
} from "../../features/packages/shared.js";
import {
  TEST_PROJECT_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  q,
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
  vi.mocked(listProjectPackages).mockResolvedValue([
    { package: "lodash", version: "4.17.15" },
  ] as any);
  vi.mocked(rebuildProjectPackages).mockResolvedValue(3);
  vi.mocked(db.delete).mockReturnValue(
    q([{ id: "usage-1" }, { id: "usage-2" }]) as any,
  );
});

describe("package routes", () => {
  it("lists project packages", async () => {
    const res = await buildApp(projectPackagesRouter).request(
      `/v1/projects/${TEST_PROJECT_ID}/packages`,
    );

    expect(res.status).toBe(200);
    expect(listProjectPackages).toHaveBeenCalledWith(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
    );
    expect(await res.json()).toEqual({
      packages: [{ package: "lodash", version: "4.17.15" }],
    });
  });

  it("deletes project package usage rows", async () => {
    const res = await buildApp(projectPackagesRouter).request(
      `/v1/projects/${TEST_PROJECT_ID}/packages`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2 });
  });

  it("rebuilds packages for a project", async () => {
    const res = await buildApp(packageRebuildRouter).request(
      `/v1/projects/${TEST_PROJECT_ID}/packages/rebuild`,
      { method: "POST" },
    );

    expect(res.status).toBe(200);
    expect(rebuildProjectPackages).toHaveBeenCalledWith(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
    );
    expect(await res.json()).toEqual({ rebuilt: 3 });
  });

  it("blocks list access when package read capability is missing", async () => {
    const res = await buildApp(projectPackagesRouter, false).request(
      `/v1/projects/${TEST_PROJECT_ID}/packages`,
    );

    expect(res.status).toBe(403);
    expect(listProjectPackages).not.toHaveBeenCalled();
  });
});
