import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  requireOwnerOrAdmin,
  requireTenantCapability,
  requireTenantCapabilityAccess,
  requireTenantOwnerOrAdminAccess,
  requireTenantParamAccess,
} from "../../http/guards.js";
import { TEST_TENANT_ID } from "../helpers/fakes.js";

describe("http guards", () => {
  it("requireTenantParamAccess returns tenant id when param matches auth tenant", async () => {
    const app = new Hono();
    app.get("/v1/tenants/:tenant_id/check", (c) => {
      c.set("tenantId", TEST_TENANT_ID);
      c.set("userId", "user-1");
      c.set("role", "owner");
      c.set("tenants", []);

      const tenantIdResult = requireTenantParamAccess(c);
      if (!tenantIdResult.ok) return tenantIdResult.response;
      const tenantId = tenantIdResult.value;

      return c.json({ tenantId });
    });

    const res = await app.request(`/v1/tenants/${TEST_TENANT_ID}/check`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenantId: TEST_TENANT_ID });
  });

  it("requireTenantParamAccess returns 403 when param tenant differs from auth tenant", async () => {
    const app = new Hono();
    app.get("/v1/tenants/:tenant_id/check", (c) => {
      c.set("tenantId", TEST_TENANT_ID);
      c.set("userId", "user-1");
      c.set("role", "owner");
      c.set("tenants", []);

      const tenantIdResult = requireTenantParamAccess(c);
      if (!tenantIdResult.ok) return tenantIdResult.response;
      const tenantId = tenantIdResult.value;

      return c.json({ tenantId });
    });

    const res = await app.request(
      "/v1/tenants/00000000-0000-0000-0000-000000000099/check",
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("requireOwnerOrAdmin returns 403 for member role", async () => {
    const app = new Hono();
    app.get("/check", (c) => {
      c.set("tenantId", TEST_TENANT_ID);
      c.set("userId", "user-1");
      c.set("role", "member");
      c.set("tenants", []);

      const ownerOrAdminResult = requireOwnerOrAdmin(c);
      if (!ownerOrAdminResult.ok) return ownerOrAdminResult.response;
      return c.json({ ok: true });
    });

    const res = await app.request("/check");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("requireTenantOwnerOrAdminAccess returns 403 for member role", async () => {
    const app = new Hono();
    app.get("/v1/tenants/:tenant_id/check", (c) => {
      c.set("tenantId", TEST_TENANT_ID);
      c.set("userId", "user-1");
      c.set("role", "member");
      c.set("tenants", []);

      const tenantIdResult = requireTenantOwnerOrAdminAccess(c);
      if (!tenantIdResult.ok) return tenantIdResult.response;
      const tenantId = tenantIdResult.value;

      return c.json({ tenantId });
    });

    const res = await app.request(`/v1/tenants/${TEST_TENANT_ID}/check`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("requireTenantCapability allows demo to access a read capability", async () => {
    const app = new Hono();
    app.get("/check", (c) => {
      c.set("tenantId", TEST_TENANT_ID);
      c.set("userId", "user-1");
      c.set("role", "demo");
      c.set("tenants", []);

      const capabilityResult = requireTenantCapability(c, "performance.read");
    if (!capabilityResult.ok) return capabilityResult.response;
      return c.json({ ok: true });
    });

    const res = await app.request("/check");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("requireTenantCapability blocks demo from a write capability", async () => {
    const app = new Hono();
    app.get("/check", (c) => {
      c.set("tenantId", TEST_TENANT_ID);
      c.set("userId", "user-1");
      c.set("role", "demo");
      c.set("tenants", []);

      const capabilityResult = requireTenantCapability(c, "projects.create");
    if (!capabilityResult.ok) return capabilityResult.response;
      return c.json({ ok: true });
    });

    const res = await app.request("/check");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("requireTenantCapabilityAccess returns tenant id for demo read access", async () => {
    const app = new Hono();
    app.get("/v1/tenants/:tenant_id/check", (c) => {
      c.set("tenantId", TEST_TENANT_ID);
      c.set("userId", "user-1");
      c.set("role", "demo");
      c.set("tenants", []);

      const tenantIdResult = requireTenantCapabilityAccess(c, "settings.read");
      if (!tenantIdResult.ok) return tenantIdResult.response;
      const tenantId = tenantIdResult.value;

      return c.json({ tenantId });
    });

    const res = await app.request(`/v1/tenants/${TEST_TENANT_ID}/check`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenantId: TEST_TENANT_ID });
  });
});
