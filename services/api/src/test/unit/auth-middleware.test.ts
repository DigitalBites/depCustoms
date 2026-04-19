import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    authUrl: "http://api.local",
    gotrueUrl: "http://gotrue.local",
  },
}));
vi.mock("../../middleware/rbac.js", () => ({
  TENANT_ROLE_METADATA: {
    owner: { assignable: false, ownerLevel: true, implicitProjectAccess: true },
    admin: { assignable: true, ownerLevel: true, implicitProjectAccess: true },
    demo: { assignable: false, ownerLevel: false, implicitProjectAccess: true },
    member: {
      assignable: true,
      ownerLevel: false,
      implicitProjectAccess: false,
    },
    guest: {
      assignable: true,
      ownerLevel: false,
      implicitProjectAccess: false,
    },
  },
  TENANT_ROLES: ["owner", "admin", "demo", "member", "guest"],
  isTenantRole: (value: string) =>
    ["owner", "admin", "demo", "member", "guest"].includes(value),
}));
vi.mock("../../auth/jwt-verifier.js", () => ({
  verifyAccessToken: vi.fn(),
  JwtVerificationError: class JwtVerificationError extends Error {
    kind: "misconfigured" | "invalid" | "expired" | "unavailable";
    constructor(
      kind: "misconfigured" | "invalid" | "expired" | "unavailable",
      message: string,
    ) {
      super(message);
      this.kind = kind;
    }
  },
}));

import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import {
  JwtVerificationError,
  verifyAccessToken,
} from "../../auth/jwt-verifier.js";
import { TEST_TENANT_ID } from "../helpers/fakes.js";

function makePayload(appMetadata: Record<string, unknown>) {
  return {
    sub: "11111111-1111-1111-1111-111111111111",
    aud: ["authenticated"],
    app_metadata: appMetadata,
  };
}

const app = new Hono();
app.use("*", authMiddleware);
app.get("/protected", (c) => c.json({ ok: true, tenantId: c.get("tenantId") }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authMiddleware", () => {
  it("returns 503 when JWKS is unavailable", async () => {
    vi.mocked(verifyAccessToken).mockRejectedValue(
      new JwtVerificationError("unavailable", "timed out"),
    );

    const token = "signed.jwt";

    const res = await app.request("/protected", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("AUTH_UNAVAILABLE");
  });

  it("returns 401 for an invalid token", async () => {
    vi.mocked(verifyAccessToken).mockRejectedValue(
      new JwtVerificationError("invalid", "invalid"),
    );

    const token = "signed.jwt";

    const res = await app.request("/protected", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_TOKEN");
  });

  it("sets auth context from a verified JWT payload", async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue(
      makePayload({
        tenant_id: TEST_TENANT_ID,
        role: "member",
        tenants: [],
      }),
    );

    const res = await app.request("/protected", {
      headers: {
        Authorization: "Bearer signed.jwt",
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tenantId).toBe(TEST_TENANT_ID);
  });

  it("returns 401 when tenant claims are missing", async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue(
      makePayload({
        role: "member",
        tenants: [],
      }),
    );

    const res = await app.request("/protected", {
      headers: {
        Authorization: "Bearer signed.jwt",
      },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("NO_TENANT");
  });
});
