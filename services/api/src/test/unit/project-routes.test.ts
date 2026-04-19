import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    environment: "test",
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
  requireTenantParamAccess: vi.fn((c: any) => c.req.param("tenant_id")),
}));

vi.mock("../../features/projects/service.js", () => ({
  listTenantProjects: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
}));

import { Hono } from "hono";
import { projectRoutes } from "../../features/projects/routes.js";
import {
  createProject,
  deleteProject,
  listTenantProjects,
} from "../../features/projects/service.js";
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
  app.route("/", projectRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listTenantProjects).mockResolvedValue([
    { id: TEST_PROJECT_ID, name: "Alpha" },
  ] as any);
  vi.mocked(createProject).mockResolvedValue({
    id: TEST_PROJECT_ID,
    name: "Alpha",
  } as any);
});

describe("project routes", () => {
  it("lists tenant projects", async () => {
    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/projects`,
    );

    expect(res.status).toBe(200);
    expect(listTenantProjects).toHaveBeenCalledWith({
      tenantId: TEST_TENANT_ID,
      userId: TEST_USER_ID,
      role: "owner",
    });
    expect(await res.json()).toEqual({
      projects: [{ id: TEST_PROJECT_ID, name: "Alpha" }],
    });
  });

  it("creates a project", async () => {
    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/projects`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alpha" }),
      },
    );

    expect(res.status).toBe(201);
    expect(createProject).toHaveBeenCalledWith({
      tenantId: TEST_TENANT_ID,
      userId: TEST_USER_ID,
      role: "owner",
      name: "Alpha",
    });
  });

  it("returns 404 when deleting a missing project", async () => {
    vi.mocked(deleteProject).mockResolvedValueOnce(null as any);

    const res = await buildApp().request(`/v1/projects/${TEST_PROJECT_ID}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Project not found",
        detail: TEST_PROJECT_ID,
      },
    });
  });

  it("blocks project listing without permission", async () => {
    const res = await buildApp(false).request(
      `/v1/tenants/${TEST_TENANT_ID}/projects`,
    );

    expect(res.status).toBe(403);
    expect(listTenantProjects).not.toHaveBeenCalled();
  });
});
