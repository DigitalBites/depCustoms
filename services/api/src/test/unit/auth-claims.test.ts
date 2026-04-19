import { describe, expect, it } from "vitest";
import {
  InvalidAuthClaimsError,
  parseAccessTokenClaims,
  parseMcpAccessTokenClaims,
} from "../../auth/auth-claims.js";
import { TEST_TENANT_ID } from "../helpers/fakes.js";

function makeToken(appMetadata: Record<string, unknown>) {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ app_metadata: appMetadata }),
  ).toString("base64url");
  return `${header}.${payload}.signature`;
}

function makeMcpToken(payload: Record<string, unknown>) {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  return `${header}.${encodedPayload}.signature`;
}

describe("parseAccessTokenClaims", () => {
  it("parses valid tenant claims", () => {
    const token = makeToken({
      tenant_id: TEST_TENANT_ID,
      role: "admin",
      tenants: [
        {
          tenant_id: TEST_TENANT_ID,
          tenant_name: "Test Organisation",
          role: "admin",
        },
      ],
    });

    expect(parseAccessTokenClaims(token)).toEqual({
      tenantId: TEST_TENANT_ID,
      role: "admin",
      tenants: [
        {
          tenant_id: TEST_TENANT_ID,
          tenant_name: "Test Organisation",
          role: "admin",
        },
      ],
    });
  });

  it("returns null when tenant_id is missing", () => {
    const token = makeToken({ role: "member", tenants: [] });
    expect(parseAccessTokenClaims(token)).toBeNull();
  });

  it("rejects invalid role values", () => {
    const token = makeToken({
      tenant_id: TEST_TENANT_ID,
      role: "super-admin",
      tenants: [],
    });

    expect(() => parseAccessTokenClaims(token)).toThrow(InvalidAuthClaimsError);
  });

  it("rejects malformed tenant membership arrays", () => {
    const token = makeToken({
      tenant_id: TEST_TENANT_ID,
      role: "owner",
      tenants: [{ tenant_id: TEST_TENANT_ID, tenant_name: "", role: "owner" }],
    });

    expect(() => parseAccessTokenClaims(token)).toThrow(InvalidAuthClaimsError);
  });
});

describe("parseMcpAccessTokenClaims", () => {
  it("parses MCP-specific claims", () => {
    const token = makeMcpToken({
      aud: ["authenticated", "mcp"],
      client_id: "codex",
      session_id: "session-1",
      app_metadata: {
        tenant_id: TEST_TENANT_ID,
        role: "member",
        tenants: [
          {
            tenant_id: TEST_TENANT_ID,
            tenant_name: "Test Organisation",
            role: "member",
          },
        ],
      },
    });

    expect(parseMcpAccessTokenClaims(token)).toEqual({
      tenantId: TEST_TENANT_ID,
      role: "member",
      tenants: [
        {
          tenant_id: TEST_TENANT_ID,
          tenant_name: "Test Organisation",
          role: "member",
        },
      ],
      audiences: ["authenticated", "mcp"],
      clientId: "codex",
      sessionId: "session-1",
    });
  });
});
