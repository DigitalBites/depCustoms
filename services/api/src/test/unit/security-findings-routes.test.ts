import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    environment: "test",
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
  getAuthContext: (c: any) => ({
    tenantId: c.get("tenantId"),
    userId: c.get("userId"),
    role: c.get("role"),
  }),
  requireProjectAccess: vi.fn(async (c: any) => ({
    ok: true,
    value: {
      projectId: c.req.param("project_id"),
      project: { id: c.req.param("project_id") },
    },
  })),
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
}));

import { Hono } from "hono";
import { db } from "../../db/index.js";
import { projectSecurityFindingsRouter } from "../../features/security/findings-routes.js";
import {
  TEST_PROJECT_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  q,
} from "../helpers/fakes.js";

function buildApp(capabilityAllowed = true) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenantId", TEST_TENANT_ID);
    c.set("userId", TEST_USER_ID);
    c.set("role", "owner");
    c.set("capabilityAllowed", capabilityAllowed);
    await next();
  });
  app.route("/", projectSecurityFindingsRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.select)
    .mockReturnValueOnce(
      q([
        {
          id: "finding-1",
          project_id: TEST_PROJECT_ID,
          tenant_id: TEST_TENANT_ID,
          connector_key: "osv",
          entity_id: "npm:lodash:4.17.15",
          finding_id: "CVE-1",
          severity: "HIGH",
          title: "Issue",
          status: "open",
          last_seen_at: new Date("2026-04-18T00:00:00Z"),
        },
      ]) as any,
    )
    .mockReturnValueOnce(q([{ count: "1" }]) as any)
    .mockReturnValueOnce(
      q([{ entity_id: "npm:lodash:4.17.15", count: "2" }]) as any,
    );
  vi.mocked(db.update).mockReturnValue(
    q([{ id: "finding-1", status: "suppressed" }]) as any,
  );
  vi.mocked(db.insert).mockReturnValue(q([]) as any);
});

describe("security findings routes", () => {
  it("lists project findings with open violation counts", async () => {
    const res = await buildApp().request(
      `/v1/projects/${TEST_PROJECT_ID}/findings?connector_key=osv&status=open&severity=HIGH&limit=10&offset=0`,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      findings: [
        expect.objectContaining({
          id: "finding-1",
          open_violation_count: 2,
        }),
      ],
      pagination: { total: 1, offset: 0, limit: 10 },
    });
  });

  it("patches a finding status to suppressed", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        {
          id: "finding-1",
          project_id: TEST_PROJECT_ID,
          tenant_id: TEST_TENANT_ID,
          entity_id: "npm:lodash:4.17.15",
        },
      ]) as any,
    );

    const res = await buildApp().request(
      `/v1/projects/${TEST_PROJECT_ID}/findings/00000000-0000-0000-0000-000000000123/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "suppressed", status_note: "accepted" }),
      },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      finding: { id: "finding-1", status: "suppressed" },
    });
  });

  it("returns 403 when the caller lacks project security capability", async () => {
    const res = await buildApp(false).request(
      `/v1/projects/${TEST_PROJECT_ID}/findings`,
    );

    expect(res.status).toBe(403);
  });
});
