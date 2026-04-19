import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(),
}));
vi.mock("../../config.js", () => ({
  config: {
    gotrueUrl: "http://gotrue.local",
    gotrueServiceRoleKey: "service-role-key",
    gotrueRequestTimeoutMs: 5000,
  },
}));

import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { authRouter } from "../../routes/auth.js";
import { TEST_TENANT_ID, TEST_USER_ID } from "../helpers/fakes.js";

const app = new Hono();
app.route("/", authRouter);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authMiddleware).mockImplementation(async (c, next) => {
    c.set("tenantId", TEST_TENANT_ID);
    c.set("userId", TEST_USER_ID);
    c.set("role", "member");
    c.set("tenants", []);
    await next();
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(""),
      json: vi.fn().mockResolvedValue({}),
    }),
  );
});

describe("POST /v1/auth/preferred-tenant", () => {
  it("returns 403 when the requested tenant is not present in session claims", async () => {
    const res = await app.request("/v1/auth/preferred-tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    });

    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("updates preferred_tenant_id when current membership exists", async () => {
    vi.mocked(authMiddleware).mockImplementationOnce(async (c, next) => {
      c.set("tenantId", TEST_TENANT_ID);
      c.set("userId", TEST_USER_ID);
      c.set("role", "member");
      c.set("tenants", [
        {
          tenant_id: TEST_TENANT_ID,
          tenant_name: "Test Organisation",
          role: "member",
        },
      ]);
      await next();
    });

    const res = await app.request("/v1/auth/preferred-tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      `http://gotrue.local/admin/users/${TEST_USER_ID}`,
      expect.objectContaining({
        method: "PUT",
      }),
    );
  });
});
