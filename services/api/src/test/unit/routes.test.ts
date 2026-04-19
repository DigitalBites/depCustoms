/**
 * Unit tests for REST route handlers — HTTP contract tests.
 *
 * Auth strategy: mock authMiddleware to inject (tenantId, userId, role) directly.
 * All DB calls are mocked via vi.mock.
 *
 * Tests the proxies router as a representative example covering:
 *   - Auth enforcement (401 when no Authorization header)
 *   - Role enforcement (403 when member)
 *   - Request validation (400 on bad body)
 *   - Success paths (201, 200)
 *   - Not-found (404)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks must be declared before imports of the modules they replace.
vi.mock("../../db/index.js");
vi.mock("../../middleware/auth.js");

import { Hono } from "hono";
import { db } from "../../db/index.js";
import { authMiddleware } from "../../middleware/auth.js";
import { proxiesRouter } from "../../routes/proxies.js";
import { q, fakeProxy, TEST_TENANT_ID } from "../helpers/fakes.js";

// ---------------------------------------------------------------------------
// Configurable auth injection
// ---------------------------------------------------------------------------

let mockRole = "owner";

vi.mocked(authMiddleware).mockImplementation(async (c, next) => {
  c.set("tenantId", TEST_TENANT_ID);
  c.set("userId", "test-user-id");
  c.set("role", mockRole);
  await next();
});

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------

const app = new Hono();
app.route("/", proxiesRouter);

beforeEach(() => {
  mockRole = "owner"; // reset to default before each test
  vi.clearAllMocks();
  // Re-apply after clearAllMocks (which resets the mock implementation)
  vi.mocked(authMiddleware).mockImplementation(async (c, next) => {
    c.set("tenantId", TEST_TENANT_ID);
    c.set("userId", "test-user-id");
    c.set("role", mockRole);
    await next();
  });
  vi.mocked(db.insert).mockReturnValue(q(undefined) as any);
  vi.mocked(db.update).mockReturnValue(q(undefined) as any);
  vi.mocked(db.delete).mockReturnValue(q([]) as any);
});

// ---------------------------------------------------------------------------
// Auth enforcement — authMiddleware is the gatekeeper
// ---------------------------------------------------------------------------

describe("auth enforcement", () => {
  it("returns 401 when authMiddleware rejects (no token)", async () => {
    // Override to simulate missing token rejection
    vi.mocked(authMiddleware).mockImplementationOnce(async (c) => {
      return c.json(
        {
          error: {
            code: "MISSING_TOKEN",
            message: "Authorization header required",
            detail: null,
          },
        },
        401,
      );
    });

    const res = await app.request("/v1/proxies");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("MISSING_TOKEN");
  });
});

// ---------------------------------------------------------------------------
// GET /v1/proxies
// ---------------------------------------------------------------------------

describe("GET /v1/proxies", () => {
  it("returns 200 and a list of proxies", async () => {
    const proxy = fakeProxy({ tenant_id: TEST_TENANT_ID });
    vi.mocked(db.select).mockReturnValueOnce(q([proxy]) as any);

    const res = await app.request("/v1/proxies");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proxies).toHaveLength(1);
    expect(body.proxies[0].name).toBe(proxy.name);
    expect(body.proxies[0].status).toBe(proxy.status);
  });

  it("returns an empty list when no proxies are registered", async () => {
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any);

    const res = await app.request("/v1/proxies");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proxies).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /v1/proxies
// ---------------------------------------------------------------------------

describe("POST /v1/proxies", () => {
  it("returns 201 with proxy_id and secret on success", async () => {
    const res = await app.request("/v1/proxies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "my-proxy" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.proxy_id).toBeTruthy();
    expect(body.secret).toMatch(/^cxp_/);
    expect(body.name).toBe("my-proxy");
    expect(body.status).toBe("active");
    expect(body.message).toContain("not be shown again");
  });

  it("returns 400 when name is missing", async () => {
    const res = await app.request("/v1/proxies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when name is empty string", async () => {
    const res = await app.request("/v1/proxies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 when role is member", async () => {
    mockRole = "member";

    const res = await app.request("/v1/proxies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "proxy" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------
// DELETE /v1/proxies/:proxyId
// ---------------------------------------------------------------------------

describe("DELETE /v1/proxies/:proxyId", () => {
  it("returns 200 when proxy is deleted", async () => {
    vi.mocked(db.update).mockReturnValue(
      q([
        { id: "00000000-0000-0000-0000-000000000001", status: "revoked" },
      ]) as any,
    );

    const res = await app.request(
      "/v1/proxies/00000000-0000-0000-0000-000000000010",
      {
        method: "DELETE",
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
  });

  it("returns 404 when proxy does not exist", async () => {
    vi.mocked(db.update).mockReturnValue(q([]) as any);

    const res = await app.request(
      "/v1/proxies/00000000-0000-0000-0000-000000000011",
      {
        method: "DELETE",
      },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 403 for member role on delete", async () => {
    mockRole = "member";

    const res = await app.request(
      "/v1/proxies/00000000-0000-0000-0000-000000000012",
      {
        method: "DELETE",
      },
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/proxies/:proxyId/disable", () => {
  it("returns 200 when proxy is disabled", async () => {
    vi.mocked(db.update).mockReturnValue(
      q([
        { id: "00000000-0000-0000-0000-000000000001", status: "disabled" },
      ]) as any,
    );

    const res = await app.request(
      "/v1/proxies/00000000-0000-0000-0000-000000000010/disable",
      {
        method: "POST",
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("disabled");
  });
});

describe("POST /v1/proxies/:proxyId/enable", () => {
  it("returns 200 when proxy is enabled", async () => {
    vi.mocked(db.update).mockReturnValue(
      q([
        { id: "00000000-0000-0000-0000-000000000001", status: "active" },
      ]) as any,
    );

    const res = await app.request(
      "/v1/proxies/00000000-0000-0000-0000-000000000010/enable",
      {
        method: "POST",
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("active");
  });
});

describe("POST /v1/proxies/:proxyId/rotate-secret", () => {
  it("returns 200 with a replacement secret", async () => {
    vi.mocked(db.update).mockReturnValue(
      q([
        {
          proxy_id: "00000000-0000-0000-0000-000000000010",
          secret_rotated_at: new Date("2026-01-01T00:00:00Z"),
        },
      ]) as any,
    );

    const res = await app.request(
      "/v1/proxies/00000000-0000-0000-0000-000000000010/rotate-secret",
      {
        method: "POST",
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.secret).toMatch(/^cxp_/);
    expect(body.previous_secret_expires_at).toBeTruthy();
  });
});
