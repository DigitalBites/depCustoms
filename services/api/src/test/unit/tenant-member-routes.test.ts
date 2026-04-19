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
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock("../../http/guards.js", () => ({
  getAuthContext: (c: any) => ({
    tenantId: c.get("tenantId"),
    userId: c.get("userId"),
    role: c.get("role"),
    tenants: c.get("tenants"),
  }),
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
  requireTenantParamAccess: (c: any, paramName = "tenant_id") => {
    const tenantId = c.req.param(paramName);
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
  requireResolvedProjectAccess: vi.fn(async (_c: any, projectId: string) => ({
    projectId,
    project: { id: projectId },
  })),
}));

vi.mock("../../auth/admin-service.js", () => {
  class AuthAdminServiceError extends Error {
    kind: "misconfigured" | "upstream";
    status?: number;

    constructor(
      kind: "misconfigured" | "upstream",
      operation: string,
      message: string,
      options?: { status?: number },
    ) {
      super(message);
      this.name = "AuthAdminServiceError";
      this.kind = kind;
      this.status = options?.status;
      this.cause = operation;
    }
  }

  return {
    AuthAdminServiceError,
    authAdminService: {
      listUsers: vi.fn(),
      createUser: vi.fn(),
      deleteUser: vi.fn(),
      getUser: vi.fn(),
      updateUser: vi.fn(),
    },
  };
});

import { Hono } from "hono";
import { db } from "../../db/index.js";
import { tenantMemberRouter } from "../../features/tenants/member-routes.js";
import {
  authAdminService,
  AuthAdminServiceError,
} from "../../auth/admin-service.js";
import { q, TEST_TENANT_ID, TEST_USER_ID } from "../helpers/fakes.js";
import { requireResolvedProjectAccess } from "../../http/guards.js";

function buildApp(role = "owner", capabilityAllowed = true) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenantId", TEST_TENANT_ID);
    c.set("userId", TEST_USER_ID);
    c.set("role", role);
    c.set("capabilityAllowed", capabilityAllowed);
    await next();
  });
  app.route("/", tenantMemberRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.select).mockReset();
  vi.mocked(db.insert).mockReset();
  vi.mocked(db.update).mockReset();
  vi.mocked(db.transaction).mockReset();
  vi.mocked(authAdminService.listUsers).mockResolvedValue([]);
  vi.mocked(authAdminService.createUser).mockResolvedValue({
    id: "00000000-0000-0000-0000-000000000111",
    email: "new-user@example.com",
  });
  vi.mocked(authAdminService.deleteUser).mockResolvedValue(undefined);
  vi.mocked(authAdminService.getUser).mockResolvedValue({
    id: TEST_USER_ID,
    app_metadata: { provider: "email" },
  });
  vi.mocked(authAdminService.updateUser).mockResolvedValue(undefined);
  vi.mocked(requireResolvedProjectAccess).mockResolvedValue({
    projectId: "00000000-0000-0000-0000-000000000222",
    project: { id: "00000000-0000-0000-0000-000000000222" } as any,
  });
  vi.mocked(db.update).mockReturnValue(q([]) as any);
  vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
    const tx = { insert: vi.fn(() => q(undefined) as any) };
    return await fn(tx);
  });
});

describe("tenantMemberRouter", () => {
  it("lists tenant members with auth enrichment", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        {
          user_id: TEST_USER_ID,
          role: "owner",
          joined_at: new Date("2026-01-01T00:00:00Z"),
        },
      ]) as any,
    );
    vi.mocked(authAdminService.listUsers).mockResolvedValueOnce([
      {
        id: TEST_USER_ID,
        email: "owner@example.com",
        last_sign_in_at: "2026-04-01T00:00:00Z",
        app_metadata: { provider: "github" },
      },
    ]);

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/members`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toEqual([
      expect.objectContaining({
        user_id: TEST_USER_ID,
        email: "owner@example.com",
        provider: "github",
        last_sign_in_at: "2026-04-01T00:00:00Z",
      }),
    ]);
  });

  it("lists tenant members without auth enrichment when the auth service fails", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        {
          user_id: TEST_USER_ID,
          role: "owner",
          joined_at: new Date("2026-01-01T00:00:00Z"),
        },
      ]) as any,
    );
    vi.mocked(authAdminService.listUsers).mockRejectedValueOnce(
      new Error("boom"),
    );

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/members`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members[0]).toEqual(
      expect.objectContaining({
        email: null,
        provider: null,
        last_sign_in_at: null,
      }),
    );
  });

  it("creates a tenant member and scoped project membership", async () => {
    const projectId = "00000000-0000-0000-0000-000000000222";
    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/members`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "new-user@example.com",
          password: "password123",
          role: "member",
          project_id: projectId,
        }),
      },
    );

    expect(res.status).toBe(201);
    expect(requireResolvedProjectAccess).toHaveBeenCalledWith(
      expect.anything(),
      projectId,
    );
    expect(authAdminService.createUser).toHaveBeenCalledWith(
      "new-user@example.com",
      "password123",
    );
    const body = await res.json();
    expect(body.created).toEqual({
      email: "new-user@example.com",
      role: "member",
    });
  });

  it("returns 409 when the auth provider reports that the user already exists", async () => {
    vi.mocked(authAdminService.createUser).mockRejectedValueOnce(
      new AuthAdminServiceError("upstream", "create_user", "exists", {
        status: 409,
      }),
    );

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/members`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "new-user@example.com",
          password: "password123",
          role: "admin",
        }),
      },
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("USER_EXISTS");
  });

  it("cleans up the created auth user when membership recording fails", async () => {
    vi.mocked(db.transaction).mockRejectedValueOnce(new Error("db failed"));

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/members`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "new-user@example.com",
          password: "password123",
          role: "admin",
        }),
      },
    );

    expect(res.status).toBe(500);
    expect(authAdminService.deleteUser).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000111",
    );
    const body = await res.json();
    expect(body.error.code).toBe("CREATE_MEMBER_FAILED");
  });

  it("returns 404 when patching a member that is not in the tenant", async () => {
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any);

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/members/${TEST_USER_ID}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      },
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 409 when attempting to change the owner role", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([{ user_id: TEST_USER_ID, role: "owner" }]) as any,
    );

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/members/${TEST_USER_ID}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      },
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_STATE");
  });

  it("updates a member role", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([{ user_id: TEST_USER_ID, role: "member" }]) as any,
    );
    vi.mocked(db.update).mockReturnValueOnce(
      q([
        {
          user_id: TEST_USER_ID,
          role: "admin",
          joined_at: new Date("2026-01-01T00:00:00Z"),
        },
      ]) as any,
    );

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/members/${TEST_USER_ID}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.member.role).toBe("admin");
  });

  it("returns 404 when resetting the password for a missing membership", async () => {
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any);

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/members/${TEST_USER_ID}/reset-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "updated-password" }),
      },
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 when the auth record is missing during password reset", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([{ user_id: TEST_USER_ID }]) as any,
    );
    vi.mocked(authAdminService.getUser).mockResolvedValueOnce(null);

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/members/${TEST_USER_ID}/reset-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "updated-password" }),
      },
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("USER_NOT_FOUND");
  });

  it("rejects password resets for SSO-managed accounts", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([{ user_id: TEST_USER_ID }]) as any,
    );
    vi.mocked(authAdminService.getUser).mockResolvedValueOnce({
      id: TEST_USER_ID,
      app_metadata: { provider: "google" },
    });

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/members/${TEST_USER_ID}/reset-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "updated-password" }),
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("SSO_ACCOUNT");
  });

  it("resets the password for email users", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([{ user_id: TEST_USER_ID }]) as any,
    );

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/members/${TEST_USER_ID}/reset-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "updated-password" }),
      },
    );

    expect(res.status).toBe(200);
    expect(authAdminService.updateUser).toHaveBeenCalledWith(TEST_USER_ID, {
      password: "updated-password",
    });
    expect(await res.json()).toEqual({ ok: true });
  });
});
