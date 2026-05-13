import { beforeEach, describe, expect, it, vi } from "vitest";
import { VALID_TO_INFINITY_ISO } from "@customs/shared-constants";

vi.mock("../../db/index.js");
vi.mock("../../middleware/auth.js");
vi.mock(
  "../../features/mcp/services/project-access.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../features/mcp/services/project-access.js")
      >();
    return {
      ...actual,
      listAccessibleMcpProjects: vi.fn(),
    };
  },
);
vi.mock("../../config.js", () => ({
  config: {
    databaseUrl: "postgres://test:test@localhost:5432/test",
    authUrl: "http://api.local",
    gotrueUrl: "http://gotrue.local",
    logLevel: "info",
    environment: "test",
  },
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
import { config } from "../../config.js";
import { db } from "../../db/index.js";
import { authMiddleware } from "../../middleware/auth.js";
import { verifyAccessToken } from "../../auth/jwt-verifier.js";
import { listAccessibleMcpProjects } from "../../features/mcp/services/project-access.js";
import { mcpRoutes } from "../../routes/mcp.js";
import {
  TEST_TENANT_ID,
  TEST_USER_ID,
  fakeEntitlement,
  q,
} from "../helpers/fakes.js";

function makeMcpToken(overrides: Record<string, unknown> = {}) {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: TEST_USER_ID,
      aud: ["authenticated", "mcp"],
      client_id: "codex",
      session_id: "session-1",
      app_metadata: {
        tenant_id: TEST_TENANT_ID,
        role: "owner",
        tenants: [
          {
            tenant_id: TEST_TENANT_ID,
            tenant_name: "Test Organisation",
            role: "owner",
          },
        ],
      },
      ...overrides,
    }),
  ).toString("base64url");

  return `${header}.${payload}.signature`;
}

function makeVerifiedMcpPayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: TEST_USER_ID,
    aud: ["authenticated", "mcp"],
    client_id: "codex",
    session_id: "session-1",
    app_metadata: {
      tenant_id: TEST_TENANT_ID,
      role: "owner",
      tenants: [
        {
          tenant_id: TEST_TENANT_ID,
          tenant_name: "Test Organisation",
          role: "owner",
        },
      ],
    },
    ...overrides,
  };
}

const app = new Hono();
app.route("/", mcpRoutes);

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(authMiddleware).mockImplementation(async (c, next) => {
    c.set("tenantId", TEST_TENANT_ID);
    c.set("userId", TEST_USER_ID);
    c.set("role", "owner");
    c.set("tenants", [
      {
        tenant_id: TEST_TENANT_ID,
        tenant_name: "Test Organisation",
        role: "owner",
      },
    ]);
    await next();
  });

  vi.mocked(db.select).mockReturnValue(
    q([fakeEntitlement({ mcp_enabled: true })]) as any,
  );
  vi.mocked(db.insert).mockReturnValue(q(undefined) as any);
  vi.mocked(listAccessibleMcpProjects).mockResolvedValue([]);
  vi.mocked(verifyAccessToken).mockImplementation(async (token) => {
    const [, payloadSegment] = token.split(".");
    if (!payloadSegment) return makeVerifiedMcpPayload() as any;
    return JSON.parse(Buffer.from(payloadSegment, "base64url").toString());
  });
});

describe("POST /v1/mcp/connections", () => {
  it("returns bootstrap metadata for an entitled tenant", async () => {
    (config as unknown as { authUrl: string }).authUrl =
      "https://customs.local:8443";
    const res = await app.request("/v1/mcp/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: TEST_TENANT_ID,
        client_name: "Codex",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.endpoint_url).toBe("https://customs.local:8443/api/mcp");
    expect(body.tenant_id).toBe(TEST_TENANT_ID);
    expect(body.client_name).toBe("Codex");
    expect(body.supported_clients).toEqual([
      { id: "codex", label: "Codex" },
      { id: "claude_code", label: "Claude Code" },
    ]);
  });

  it("returns 500 for bootstrap when auth URL is unset", async () => {
    (config as unknown as { authUrl: string }).authUrl = "";

    const res = await app.request("http://localhost:3000/v1/mcp/connections", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "customs.local:8443",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "customs.local:8443",
      },
      body: JSON.stringify({
        tenant_id: TEST_TENANT_ID,
        client_name: "Codex",
      }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("SERVER_MISCONFIGURED");
    expect(body.error.message).toBe("Public auth URL is not configured");
  });

  it("rejects tenants without the MCP entitlement", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([fakeEntitlement({ mcp_enabled: false })]) as any,
    );

    const res = await app.request("/v1/mcp/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: TEST_TENANT_ID,
        client_name: "Codex",
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("MCP_DISABLED");
  });

  it("rejects bootstrap for a tenant outside the authenticated membership set", async () => {
    const otherTenantId = "00000000-0000-0000-0000-000000000123";

    const res = await app.request("/v1/mcp/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: otherTenantId,
        client_name: "Codex",
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toContain("not a member");
  });

  it("blocks guest users from creating MCP connections", async () => {
    vi.mocked(authMiddleware).mockImplementationOnce(async (c, next) => {
      c.set("tenantId", TEST_TENANT_ID);
      c.set("userId", TEST_USER_ID);
      c.set("role", "guest");
      c.set("tenants", [
        {
          tenant_id: TEST_TENANT_ID,
          tenant_name: "Test Organisation",
          role: "guest",
        },
      ]);
      await next();
    });

    const res = await app.request("/v1/mcp/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: TEST_TENANT_ID,
        client_name: "Claude Code",
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("POST /api/mcp", () => {
  it("rejects guest users on the MCP route even with a valid token", async () => {
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeMcpToken({
          app_metadata: {
            tenant_id: TEST_TENANT_ID,
            role: "guest",
            tenants: [
              {
                tenant_id: TEST_TENANT_ID,
                tenant_name: "Test Organisation",
                role: "guest",
              },
            ],
          },
        })}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("insufficient_scope");
    expect(body.error_description).toContain('role "guest"');
  });

  it("initializes an authenticated MCP session", async () => {
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeMcpToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
    expect(res.headers.get("mcp-protocol-version")).toBe("2025-11-25");
    const body = await res.json();
    expect(body.result.protocolVersion).toBe("2025-11-25");
    expect(body.result.capabilities.tools.listChanged).toBe(false);
    expect(body.result._meta.customs.accessible_projects).toEqual([]);
    expect(body.result._meta.customs.default_project).toBeNull();
  });

  it("includes accessible project context during initialize", async () => {
    vi.mocked(listAccessibleMcpProjects).mockResolvedValue([
      { id: "project-1", name: "alpha" },
      { id: "project-2", name: "beta" },
    ]);

    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeMcpToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result._meta.customs.accessible_projects).toEqual([
      { id: "project-1", name: "alpha" },
      { id: "project-2", name: "beta" },
    ]);
    expect(body.result._meta.customs.default_project).toBeNull();
  });

  it("marks the default project during initialize when only one project is accessible", async () => {
    vi.mocked(listAccessibleMcpProjects).mockResolvedValue([
      { id: "project-1", name: "alpha" },
    ]);

    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeMcpToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result._meta.customs.accessible_projects).toEqual([
      { id: "project-1", name: "alpha" },
    ]);
    expect(body.result._meta.customs.default_project).toEqual({
      id: "project-1",
      name: "alpha",
    });
  });

  it("reuses the provided MCP session id during initialize", async () => {
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeMcpToken()}`,
        "content-type": "application/json",
        "mcp-session-id": "existing-session-id",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBe("existing-session-id");
  });

  it("persists an audit event for stream.connect requests", async () => {
    const res = await app.request("/api/mcp", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${makeMcpToken()}`,
      },
    });

    expect(res.status).toBe(200);
    expect(vi.mocked(db.insert)).toHaveBeenCalled();
    const insertBuilder = vi.mocked(db.insert).mock.results[0]?.value;
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TEST_TENANT_ID,
        user_id: TEST_USER_ID,
        role: "owner",
        client_name: "codex",
        session_id: expect.any(String),
        method_name: "stream.connect",
        outcome: "success",
      }),
    );
  });

  it("rejects tokens without the MCP audience", async () => {
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeMcpToken({ aud: "authenticated" })}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("insufficient_scope");
    expect(body.error_description).toContain(
      "Token is not authorized for MCP access",
    );
    expect(res.headers.get("www-authenticate")).toContain(
      'error="insufficient_scope"',
    );
  });

  it("returns an OAuth-compatible error response when GET /api/mcp is missing a bearer token", async () => {
    const res = await app.request("/api/mcp", {
      method: "GET",
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
    expect(body.error_description).toContain(
      "Authorization header with Bearer token is required",
    );
    expect(res.headers.get("www-authenticate")).toContain(
      'Bearer realm="customs-mcp"',
    );
  });

  it("returns an OAuth-compatible error response when the bearer token is missing", async () => {
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
    expect(body.error_description).toContain(
      "Authorization header with Bearer token is required",
    );
    expect(res.headers.get("www-authenticate")).toContain(
      'Bearer realm="customs-mcp"',
    );
  });

  it("acknowledges notifications/initialized and preserves the transport session", async () => {
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeMcpToken()}`,
        "content-type": "application/json",
        "mcp-session-id": "existing-session-id",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });

    expect(res.status).toBe(202);
    expect(res.headers.get("mcp-session-id")).toBe("existing-session-id");

    const insertBuilder = vi.mocked(db.insert).mock.results.at(-1)?.value;
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        method_name: "notifications/initialized",
        outcome: "success",
        session_id: "existing-session-id",
      }),
    );
  });

  it("responds to ping and preserves the transport session", async () => {
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeMcpToken()}`,
        "content-type": "application/json",
        "mcp-session-id": "existing-session-id",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "ping",
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBe("existing-session-id");
    const body = await res.json();
    expect(body.result).toEqual({});
  });

  it("returns a JSON-RPC invalid request error for malformed payloads", async () => {
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeMcpToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "1.0",
        id: 9,
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32600);
    expect(body.error.message).toBe("Invalid Request");

    const insertBuilder = vi.mocked(db.insert).mock.results.at(-1)?.value;
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        method_name: "unknown",
        outcome: "error",
        detail: "Invalid Request",
      }),
    );
  });

  it("lists an empty tool registry during Phase 1", async () => {
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeMcpToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(
      body.result.tools.map((tool: { name: string }) => tool.name).sort(),
    ).toEqual(
      [
        "explain_package_decision",
        "get_effective_policies",
        "get_project",
        "get_project_contributor_summary",
        "get_project_dependency_context",
        "get_project_security_summary",
        "find_projects_using_package",
        "list_project_contributor_packages",
        "list_project_findings",
        "list_project_packages",
        "list_projects",
        "list_project_violations",
        "list_vulnerable_packages",
        "list_recently_blocked_packages",
        "preview_dependency_change",
        "suggest_allowed_versions",
      ].sort(),
    );
  });

  it("calls get_effective_policies and returns structured tool content", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(
        q([{ id: "00000000-0000-0000-0000-000000000010", name: "Dev Project" }]) as any,
      )
      .mockReturnValueOnce(
        q([{ id: "00000000-0000-0000-0000-000000000010" }]) as any,
      )
      .mockReturnValueOnce(q([]) as any)
      .mockReturnValueOnce(
        q([
          {
            id: "00000000-0000-0000-0000-000000000100",
            policy_key: "00000000-0000-0000-0000-000000000200",
            tenant_id: TEST_TENANT_ID,
            project_id: null,
            name: "Default Security Policy",
            scope: "global",
            status: "active",
            enforcement_mode: "enforcing",
            priority: 100,
            version: 1,
            effective_from: new Date("2026-01-01T00:00:00Z"),
            effective_to: new Date(VALID_TO_INFINITY_ISO),
            superseded_by_id: null,
          },
        ]) as any,
      )
      .mockReturnValueOnce(q([]) as any)
      .mockReturnValueOnce(
        q([
          {
            binding_id: "00000000-0000-0000-0000-000000000201",
            policy_id: "00000000-0000-0000-0000-000000000100",
            enabled: true,
            order_index: 0,
            rule: {
              id: "00000000-0000-0000-0000-000000000101",
              rule_key: "00000000-0000-0000-0000-000000000301",
              name: "Block risky packages",
              description: null,
              target_entity: "artifact",
              condition: {
                field: "asset.package",
                operator: "eq",
                value: "left-pad",
              },
              action: { type: "violation", code: "BLOCK_RISKY" },
            },
          },
        ]) as any,
      )

    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeMcpToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "get_effective_policies",
          arguments: {
            project_id: "00000000-0000-0000-0000-000000000010",
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.project_id).toBe(
      "00000000-0000-0000-0000-000000000010",
    );
    expect(body.result.structuredContent.policies).toHaveLength(1);
    expect(body.result.structuredContent.policies[0].rules).toHaveLength(1);
  });

  it("calls get_project and returns the canonical project reference", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        {
          id: "00000000-0000-0000-0000-000000000010",
          name: "Dev Project",
        },
      ]) as any,
    );

    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeMcpToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 31,
        method: "tools/call",
        params: {
          name: "get_project",
          arguments: {
            project_id: "00000000-0000-0000-0000-000000000010",
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent).toEqual({
      tenant_id: TEST_TENANT_ID,
      tenant_name: "Test Organisation",
      project_id: "00000000-0000-0000-0000-000000000010",
      project_name: "Dev Project",
    });
  });

  it("calls list_project_packages and returns package usage rows", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(
        q([
          {
            id: "00000000-0000-0000-0000-000000000010",
            name: "Dev Project",
          },
        ]) as any,
      )
      .mockReturnValueOnce(
        q([{ id: "00000000-0000-0000-0000-000000000010" }]) as any,
      );

    const fakeRows = [
      {
        id: "00000000-0000-0000-0000-000000000111",
        package_id: "00000000-0000-0000-0000-000000000112",
        ecosystem: "npm",
        package: "left-pad",
        version: "1.3.0",
        request_count: 4,
        allow_count: 4,
        block_count: 0,
        first_seen_at: new Date("2026-01-01T00:00:00Z"),
        last_seen_at: new Date("2026-01-02T00:00:00Z"),
      },
    ];

    vi.mocked(db.select).mockReturnValueOnce(q(fakeRows) as any);

    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeMcpToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "list_project_packages",
          arguments: {
            project_id: "00000000-0000-0000-0000-000000000010",
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.packages).toHaveLength(1);
    expect(body.result.structuredContent.packages[0].package).toBe("left-pad");
  });

  it("calls list_projects and returns accessible project references", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        {
          id: "00000000-0000-0000-0000-000000000010",
          name: "Dev Project",
        },
      ]) as any,
    );

    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeMcpToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 41,
        method: "tools/call",
        params: {
          name: "list_projects",
          arguments: {
            search: "dev",
            limit: 10,
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.tenant_id).toBe(TEST_TENANT_ID);
    expect(body.result.structuredContent.tenant_name).toBe(
      "Test Organisation",
    );
    expect(body.result.structuredContent.projects).toEqual([
      {
        project_id: "00000000-0000-0000-0000-000000000010",
        project_name: "Dev Project",
      },
    ]);
  });

  it("resolves a project by name for list_project_packages", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(
        q([
          {
            id: "00000000-0000-0000-0000-000000000010",
            name: "Dev Project",
          },
        ]) as any,
      )
      .mockReturnValueOnce(
        q([
          {
            id: "00000000-0000-0000-0000-000000000010",
          },
        ]) as any,
      )
      .mockReturnValueOnce(
        q([
          {
            id: "00000000-0000-0000-0000-000000000111",
            package_id: "00000000-0000-0000-0000-000000000112",
            ecosystem: "npm",
            package: "left-pad",
            version: "1.3.0",
            request_count: 4,
            allow_count: 4,
            block_count: 0,
            first_seen_at: new Date("2026-01-01T00:00:00Z"),
            last_seen_at: new Date("2026-01-02T00:00:00Z"),
          },
        ]) as any,
      );

    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeMcpToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "list_project_packages",
          arguments: {
            project_name: "Dev Project",
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.project_id).toBe(
      "00000000-0000-0000-0000-000000000010",
    );
    expect(body.result.structuredContent.packages[0].package).toBe("left-pad");
  });

  it("calls list_recently_blocked_packages and normalizes timestamp strings", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(
        q([
          {
            id: "00000000-0000-0000-0000-000000000010",
            name: "Dev Project",
          },
        ]) as any,
      )
      .mockReturnValueOnce(
        q([{ id: "00000000-0000-0000-0000-000000000010" }]) as any,
      )
      .mockReturnValueOnce(
        q([
          {
            ecosystem: "npm",
            package: "left-pad",
            version: "1.3.0",
            blocked_at: "2026-01-03T00:00:00.000Z",
            reason_summary: "Blocked by policy",
            matched_rule: "Block risky packages",
            reason_code: "POLICY_BLOCKED",
          },
        ]) as any,
      );

    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeMcpToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "list_recently_blocked_packages",
          arguments: {
            project_id: "00000000-0000-0000-0000-000000000010",
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.items).toEqual([
      {
        ecosystem: "npm",
        package: "left-pad",
        version: "1.3.0",
        blocked_at: "2026-01-03T00:00:00.000Z",
        reason_code: "POLICY_BLOCKED",
        reason_summary: "Blocked by policy",
        matched_rule: "Block risky packages",
      },
    ]);
  });
});
