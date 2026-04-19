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
    transaction: vi.fn(),
  },
}));

vi.mock("../../http/guards.js", () => ({
  getAuthContext: (c: any) => ({
    tenantId: c.get("tenantId"),
    userId: c.get("userId"),
    role: c.get("role"),
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
      findUserByEmail: vi.fn(),
      inviteUser: vi.fn(),
      deleteUser: vi.fn(),
    },
  };
});

import { Hono } from "hono";
import { db } from "../../db/index.js";
import { tenantInviteRouter } from "../../features/tenants/invite-routes.js";
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
  app.route("/", tenantInviteRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.select).mockReset();
  vi.mocked(db.insert).mockReset();
  vi.mocked(db.transaction).mockReset();
  vi.mocked(authAdminService.findUserByEmail).mockResolvedValue(null);
  vi.mocked(authAdminService.inviteUser).mockResolvedValue({
    id: "00000000-0000-0000-0000-000000000123",
    email: "invitee@example.com",
    email_confirmed_at: null,
  });
  vi.mocked(authAdminService.deleteUser).mockResolvedValue(undefined);
  vi.mocked(requireResolvedProjectAccess).mockResolvedValue({
    projectId: "00000000-0000-0000-0000-000000000222",
    project: { id: "00000000-0000-0000-0000-000000000222" } as any,
  });
  vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
    const tx = { insert: vi.fn(() => q(undefined) as any) };
    return await fn(tx);
  });
  vi.mocked(db.insert).mockReturnValue(q([{ id: "pm-1" }]) as any);
});

describe("tenantInviteRouter", () => {
  it("rejects role grants outside the caller's authority", async () => {
    const res = await buildApp("member").request(
      `/v1/tenants/${TEST_TENANT_ID}/access-grants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "user@example.com", role: "admin" }),
      },
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("rejects callers without the invite capability", async () => {
    const res = await buildApp("owner", false).request(
      `/v1/tenants/${TEST_TENANT_ID}/access-grants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "user@example.com", role: "member" }),
      },
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns already_in_tenant when the user already has tenant membership", async () => {
    vi.mocked(authAdminService.findUserByEmail).mockResolvedValueOnce({
      id: "00000000-0000-0000-0000-000000000333",
      email: "user@example.com",
    });
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        { user_id: "00000000-0000-0000-0000-000000000333", role: "member" },
      ]) as any,
    );

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/access-grants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "user@example.com", role: "member" }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access.outcome).toBe("already_in_tenant");
  });

  it("adds project access for an existing tenant member", async () => {
    const projectId = "00000000-0000-0000-0000-000000000222";
    vi.mocked(authAdminService.findUserByEmail).mockResolvedValueOnce({
      id: "00000000-0000-0000-0000-000000000333",
      email: "user@example.com",
    });
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        { user_id: "00000000-0000-0000-0000-000000000333", role: "member" },
      ]) as any,
    );
    vi.mocked(db.insert).mockReturnValueOnce(q([{ id: "pm-1" }]) as any);

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/access-grants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          role: "member",
          project_id: projectId,
        }),
      },
    );

    expect(res.status).toBe(200);
    expect(requireResolvedProjectAccess).toHaveBeenCalledWith(
      expect.anything(),
      projectId,
    );
    const body = await res.json();
    expect(body.access.outcome).toBe("project_access_added");
  });

  it("grants tenant and project access for an existing auth user", async () => {
    const projectId = "00000000-0000-0000-0000-000000000222";
    vi.mocked(authAdminService.findUserByEmail).mockResolvedValueOnce({
      id: "00000000-0000-0000-0000-000000000444",
      email: "user@example.com",
    });
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any);

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/access-grants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          role: "member",
          project_id: projectId,
        }),
      },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.access.outcome).toBe("tenant_and_project_access_added");
  });

  it("returns 500 when auth lookup is misconfigured", async () => {
    vi.mocked(authAdminService.findUserByEmail).mockRejectedValueOnce(
      new AuthAdminServiceError("misconfigured", "list_users", "bad config"),
    );

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/access-grants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          role: "member",
          project_id: "00000000-0000-0000-0000-000000000222",
        }),
      },
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("SERVER_MISCONFIGURED");
  });

  it("rolls back invited users when membership persistence fails", async () => {
    vi.mocked(db.transaction).mockRejectedValueOnce(new Error("db failed"));

    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/access-grants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "invitee@example.com", role: "admin" }),
      },
    );

    expect(res.status).toBe(500);
    expect(authAdminService.deleteUser).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000123",
    );
    const body = await res.json();
    expect(body.error.code).toBe("INVITE_FAILED");
  });

  it("sends an invite and records membership for new users", async () => {
    const res = await buildApp().request(
      `/v1/tenants/${TEST_TENANT_ID}/access-grants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "invitee@example.com", role: "admin" }),
      },
    );

    expect(res.status).toBe(201);
    expect(authAdminService.inviteUser).toHaveBeenCalledWith(
      "invitee@example.com",
    );
    const body = await res.json();
    expect(body.access.outcome).toBe("invite_sent");
  });
});
