import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    gotrueHookSecret: "hook-secret",
  },
}));

vi.mock("../../bootstrap/status-service.js", () => ({
  getBootstrapStatus: vi.fn(),
}));

vi.mock("../../auth/admin-service.js", () => ({
  AuthAdminServiceError: class AuthAdminServiceError extends Error {
    kind: "misconfigured" | "upstream";
    status?: number;
    detail?: string | null;
    constructor(
      kind: "misconfigured" | "upstream",
      operation: string,
      message: string,
      options?: { status?: number; detail?: string | null },
    ) {
      super(message);
      this.name = "AuthAdminServiceError";
      this.kind = kind;
      this.status = options?.status;
      this.detail = options?.detail ?? null;
      this.cause = operation;
    }
  },
  authAdminService: {
    createUser: vi.fn(),
  },
}));

vi.mock("../../features/internal-auth-hook/token-hook-service.js", () => ({
  buildTokenHookClaims: vi.fn(),
  parseTokenHookPayload: vi.fn(),
}));

vi.mock("../../features/internal-auth-hook/verification.js", () => ({
  verifyTokenHookRequest: vi.fn(),
}));

vi.mock("../../features/internal-proxy-auth/token-exchange-service.js", () => ({
  exchangeProxyRuntimeToken: vi.fn(),
}));

import { Hono } from "hono";
import { config } from "../../config.js";
import { getBootstrapStatus } from "../../bootstrap/status-service.js";
import {
  authAdminService,
  AuthAdminServiceError,
} from "../../auth/admin-service.js";
import { exchangeProxyRuntimeToken } from "../../features/internal-proxy-auth/token-exchange-service.js";
import { internalRouter } from "../../routes/internal.js";

const app = new Hono();
app.route("/", internalRouter);

beforeEach(() => {
  vi.clearAllMocks();
  (config as any).gotrueHookSecret = "hook-secret";
  vi.mocked(getBootstrapStatus).mockResolvedValue({
    state: "ready",
    checks: { usersExist: true },
  } as any);
  vi.mocked(authAdminService.createUser).mockResolvedValue({
    id: "00000000-0000-0000-0000-000000000099",
    email: "owner@example.com",
  } as any);
  vi.mocked(exchangeProxyRuntimeToken).mockResolvedValue({
    ok: true,
    accessToken: "access-token",
    expiresAt: new Date("2026-04-20T00:00:00Z"),
    refreshAfter: new Date("2026-04-19T12:00:00Z"),
  } as any);
});

describe("internalRouter non-token-hook routes", () => {
  it("returns bootstrap status with 200 for healthy states", async () => {
    const res = await app.request("/internal/bootstrap/status");
    expect(res.status).toBe(200);
    expect((await res.json()).state).toBe("ready");
  });

  it("returns 503 for degraded bootstrap states", async () => {
    vi.mocked(getBootstrapStatus).mockResolvedValueOnce({
      state: "degraded",
      checks: { usersExist: false },
    } as any);

    const res = await app.request("/internal/bootstrap/status");
    expect(res.status).toBe(503);
  });

  it("creates the first bootstrap user", async () => {
    vi.mocked(getBootstrapStatus).mockResolvedValueOnce({
      state: "needs_setup",
      checks: { usersExist: false },
    } as any);

    const res = await app.request("/internal/bootstrap/first-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.com",
        password: "password123",
      }),
    });

    expect(res.status).toBe(201);
    expect(authAdminService.createUser).toHaveBeenCalledWith(
      "owner@example.com",
      "password123",
    );
    expect(await res.json()).toEqual({
      user: {
        id: "00000000-0000-0000-0000-000000000099",
        email: "owner@example.com",
      },
    });
  });

  it("refuses bootstrap first-user when a user already exists", async () => {
    const res = await app.request("/internal/bootstrap/first-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.com",
        password: "password123",
      }),
    });

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("BOOTSTRAP_USER_ALREADY_EXISTS");
  });

  it("maps auth admin errors during bootstrap", async () => {
    vi.mocked(getBootstrapStatus).mockResolvedValueOnce({
      state: "needs_setup",
      checks: { usersExist: false },
    } as any);
    vi.mocked(authAdminService.createUser).mockRejectedValueOnce(
      new AuthAdminServiceError("upstream", "create_user", "bad upstream", {
        status: 422,
        detail: "duplicate email",
      }),
    );

    const res = await app.request("/internal/bootstrap/first-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.com",
        password: "password123",
      }),
    });

    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("BOOTSTRAP_FIRST_USER_FAILED");
  });

  it("rejects invalid proxy token headers", async () => {
    const res = await app.request("/internal/v1/proxy/token", {
      method: "POST",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("returns proxy runtime tokens on success", async () => {
    const res = await app.request("/internal/v1/proxy/token", {
      method: "POST",
      headers: {
        "x-proxy-id": "00000000-0000-0000-0000-000000000010",
        "x-proxy-secret": "cxp_secret",
        "x-proxy-remote-addr": "10.0.0.2",
      },
    });

    expect(res.status).toBe(200);
    expect(exchangeProxyRuntimeToken).toHaveBeenCalledWith({
      proxyId: "00000000-0000-0000-0000-000000000010",
      proxySecret: "cxp_secret",
      proxyIp: "10.0.0.2",
    });
    expect(await res.json()).toEqual({
      access_token: "access-token",
      expires_at: "2026-04-20T00:00:00.000Z",
      refresh_after: "2026-04-19T12:00:00.000Z",
    });
  });

  it("maps proxy token exchange failures", async () => {
    vi.mocked(exchangeProxyRuntimeToken).mockResolvedValueOnce({
      ok: false,
      status: 401,
      code: "INVALID_PROXY",
      message: "Invalid proxy credentials",
      detail: "bad secret",
    } as any);

    const res = await app.request("/internal/v1/proxy/token", {
      method: "POST",
      headers: {
        "x-proxy-id": "00000000-0000-0000-0000-000000000010",
        "x-proxy-secret": "cxp_secret",
      },
    });

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("INVALID_PROXY");
  });
});
