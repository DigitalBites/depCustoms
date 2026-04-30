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
    update: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock("../../http/guards.js", () => ({
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
  requireTenantParamAccess: (c: any, paramName = "tenant_id") => {
    const tenantId = c.req.param(paramName);
    if (tenantId !== c.get("tenantId")) {
      return {
        ok: false,
        response: c.json(
          {
            error: {
              code: "FORBIDDEN",
              message: "Access denied to this tenant",
              detail: null,
            },
          },
          403,
        ),
      };
    }
    return { ok: true, value: tenantId };
  },
}));

import { Hono } from "hono";
import { db } from "../../db/index.js";
import { tenantCoreRouter } from "../../features/tenants/core-routes.js";
import { q, TEST_TENANT_ID, TEST_USER_ID } from "../helpers/fakes.js";

function buildApp(capabilityAllowed = true) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenantId", TEST_TENANT_ID);
    c.set("userId", TEST_USER_ID);
    c.set("role", "owner");
    c.set("capabilityAllowed", capabilityAllowed);
    await next();
  });
  app.route("/", tenantCoreRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.select).mockReset();
  vi.mocked(db.update).mockReset();
  vi.mocked(db.insert).mockReset();
  vi.mocked(db.update).mockReturnValue(q([]) as any);
  vi.mocked(db.insert).mockReturnValue(q([]) as any);
});

describe("tenantCoreRouter", () => {
  it("returns the tenant record", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([{ id: TEST_TENANT_ID, name: "Acme" }]) as any,
    );

    const res = await buildApp().request(`/v1/tenants/${TEST_TENANT_ID}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tenant: { id: TEST_TENANT_ID, name: "Acme" },
    });
  });

  it("returns 404 when the tenant is missing", async () => {
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any);

    const res = await buildApp().request(`/v1/tenants/${TEST_TENANT_ID}`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("updates the tenant name", async () => {
    vi.mocked(db.update).mockReturnValueOnce(
      q([{ id: TEST_TENANT_ID, name: "Renamed" }]) as any,
    );

    const res = await buildApp().request(`/v1/tenants/${TEST_TENANT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).tenant.name).toBe("Renamed");
  });

  it("returns 404 when patching a missing tenant", async () => {
    vi.mocked(db.update).mockReturnValueOnce(q([]) as any);

    const res = await buildApp().request(`/v1/tenants/${TEST_TENANT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("returns default entitlements when none are configured", async () => {
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any);

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/entitlements`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entitlements: {
        allowed_ecosystems: null,
        serve_mode: "SERVE_MODE_REDIRECT",
        cache_ttl_seconds: 300,
        mcp_enabled: false,
      },
    });
  });

  it("returns stored entitlements", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        {
          allowed_ecosystems: ["npm"],
          serve_mode: "SERVE_MODE_PULL",
          cache_ttl_seconds: 600,
          mcp_enabled: true,
        },
      ]) as any,
    );

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/entitlements`,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).entitlements).toEqual({
      allowed_ecosystems: ["npm"],
      serve_mode: "SERVE_MODE_PULL",
      cache_ttl_seconds: 600,
      mcp_enabled: true,
    });
  });

  it("updates an existing entitlement row", async () => {
    vi.mocked(db.select).mockReturnValueOnce(q([{ id: "ent-1" }]) as any);
    vi.mocked(db.update).mockReturnValueOnce(
      q([
        {
          id: "ent-1",
          allowed_ecosystems: ["npm", "pypi"],
          serve_mode: "SERVE_MODE_PULL",
          cache_ttl_seconds: 900,
          mcp_enabled: true,
        },
      ]) as any,
    );

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/entitlements`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowed_ecosystems: ["npm", "pypi"],
          serve_mode: "SERVE_MODE_PULL",
          cache_ttl_seconds: 900,
          mcp_enabled: true,
        }),
      },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).entitlements).toEqual(
      expect.objectContaining({
        allowed_ecosystems: ["npm", "pypi"],
        serve_mode: "SERVE_MODE_PULL",
        cache_ttl_seconds: 900,
        mcp_enabled: true,
      }),
    );
  });

  it("creates a new entitlement row with defaults", async () => {
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any);
    vi.mocked(db.insert).mockReturnValueOnce(
      q([
        {
          tenant_id: TEST_TENANT_ID,
          allowed_ecosystems: null,
          serve_mode: "SERVE_MODE_REDIRECT",
          cache_ttl_seconds: 300,
          mcp_enabled: false,
        },
      ]) as any,
    );

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/entitlements`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowed_ecosystems: null,
        }),
      },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).entitlements).toEqual(
      expect.objectContaining({
        serve_mode: "SERVE_MODE_REDIRECT",
        cache_ttl_seconds: 300,
        mcp_enabled: false,
      }),
    );
  });
});
