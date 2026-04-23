import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    environment: "test",
  },
}));

vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
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
  requireResolvedProjectAccess: vi.fn(async () => ({
    project: { id: "p-1", tenant_id: "t-1" },
  })),
  listAccessibleProjectIds: vi.fn(async () => ["p-1"]),
  requireTenantCapabilityAccess: (
    c: any,
    _capability: string,
    message = "Access denied",
  ) => {
    if (!c.get("capabilityAllowed")) {
      c.res = c.json(
        { error: { code: "FORBIDDEN", message, detail: null } },
        403,
      );
      return null;
    }
    return c.req.param("tenant_id");
  },
}));

vi.mock("../../features/violations/enrichment.js", () => ({
  enrichViolations: vi.fn(),
}));

vi.mock("../../features/violations/finding-details.js", () => ({
  loadViolationFindings: vi.fn(),
}));

vi.mock("../../features/violations/project-shared.js", () => ({
  applyBulkViolationStatusUpdate: vi.fn(),
  applyViolationStatusUpdate: vi.fn(),
  bulkViolationStatusUpdateSchema: {
    safeParseAsync: async (v: any) => ({ success: true, data: v }),
  },
  violationStatusUpdateSchema: {
    safeParseAsync: async (v: any) => ({ success: true, data: v }),
  },
  listProjectViolations: vi.fn(),
  loadProjectViolationSummary: vi.fn(),
  requireViolationProjectAccess: vi.fn(async () => ({
    project: { tenant_id: "t-1" },
  })),
}));

vi.mock("../../features/violations/summary-format.js", () => ({
  formatViolationSummary: vi.fn((summary: any) => ({
    ...summary,
    formatted: true,
  })),
}));

vi.mock("../../features/violations/tenant-shared.js", () => ({
  loadTenantViolationSummary: vi.fn(),
}));

vi.mock("../../features/violation-suppressions/shared.js", () => ({
  createSuppressionSchema: {
    safeParseAsync: async (v: any) => ({ success: true, data: v }),
  },
  loadSuppressionForTenant: vi.fn(),
  projectExistsForTenant: vi.fn(),
}));

import { Hono } from "hono";
import { db } from "../../db/index.js";
import { projectViolationDetailRouter } from "../../features/violations/project-detail-routes.js";
import { projectViolationListRouter } from "../../features/violations/project-list-routes.js";
import { tenantViolationSummaryRouter } from "../../features/violations/tenant-summary-routes.js";
import { violationSuppressionWriteRouter } from "../../features/violation-suppressions/write-routes.js";
import { enrichViolations } from "../../features/violations/enrichment.js";
import { loadViolationFindings } from "../../features/violations/finding-details.js";
import {
  applyBulkViolationStatusUpdate,
  applyViolationStatusUpdate,
  listProjectViolations,
  loadProjectViolationSummary,
} from "../../features/violations/project-shared.js";
import { loadTenantViolationSummary } from "../../features/violations/tenant-shared.js";
import {
  loadSuppressionForTenant,
  projectExistsForTenant,
} from "../../features/violation-suppressions/shared.js";
import {
  TEST_PROJECT_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  TEST_VIOLATION_ID,
  q,
} from "../helpers/fakes.js";

function buildApp(router: Hono, capabilityAllowed = true) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenantId", TEST_TENANT_ID);
    c.set("userId", TEST_USER_ID);
    c.set("role", "owner");
    c.set("capabilityAllowed", capabilityAllowed);
    await next();
  });
  app.route("/", router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.select).mockReturnValue(q([]) as any);
  vi.mocked(db.insert).mockReturnValue(q([{ id: "supp-1" }]) as any);
  vi.mocked(db.delete).mockReturnValue(q([]) as any);
  vi.mocked(enrichViolations).mockResolvedValue([
    { id: TEST_VIOLATION_ID, entity_id: "npm:lodash:4.17.15", status: "open" },
  ] as any);
  vi.mocked(loadViolationFindings).mockResolvedValue({
    findings: [{ findingId: "CVE-1" }],
    findingSchemas: { osv: [{ key: "severity" }] },
    presentations: {
      osv: { summary: { headline: "1 finding detected" }, findings: [], findingSchema: [] },
    },
  } as any);
  vi.mocked(applyBulkViolationStatusUpdate).mockResolvedValue({
    updatedIds: [TEST_VIOLATION_ID],
  } as any);
  vi.mocked(applyViolationStatusUpdate).mockResolvedValue({
    id: TEST_VIOLATION_ID,
    project_id: TEST_PROJECT_ID,
    entity_id: "npm:lodash:4.17.15",
  } as any);
  vi.mocked(listProjectViolations).mockResolvedValue([
    { id: TEST_VIOLATION_ID, entity_id: "npm:lodash:4.17.15" },
  ] as any);
  vi.mocked(loadProjectViolationSummary).mockResolvedValue({
    open: 2,
  } as any);
  vi.mocked(loadTenantViolationSummary).mockResolvedValue({
    open: 4,
  } as any);
  vi.mocked(projectExistsForTenant).mockResolvedValue({
    id: TEST_PROJECT_ID,
  } as any);
  vi.mocked(loadSuppressionForTenant).mockResolvedValue({
    id: "supp-1",
  } as any);
});

describe("violation detail and suppression routes", () => {
  it("returns a project violation with findings", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        {
          id: TEST_VIOLATION_ID,
          project_id: TEST_PROJECT_ID,
          entity_id: "npm:lodash:4.17.15",
          tenant_id: TEST_TENANT_ID,
        },
      ]) as any,
    );

    const res = await buildApp(projectViolationDetailRouter).request(
      `/v1/violations/${TEST_VIOLATION_ID}`,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      violation: {
        id: TEST_VIOLATION_ID,
        entity_id: "npm:lodash:4.17.15",
        status: "open",
        findings: [{ findingId: "CVE-1" }],
        findingSchemas: { osv: [{ key: "severity" }] },
        presentations: {
          osv: { summary: { headline: "1 finding detected" }, findings: [], findingSchema: [] },
        },
      },
    });
  });

  it("updates violation status and bulk status", async () => {
    const single = await buildApp(projectViolationDetailRouter).request(
      `/v1/violations/${TEST_VIOLATION_ID}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved", status_note: "done" }),
      },
    );
    expect(single.status).toBe(200);

    const bulk = await buildApp(projectViolationDetailRouter).request(
      "/v1/violations/bulk-status",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          violation_ids: [TEST_VIOLATION_ID],
          status: "suppressed",
        }),
      },
    );
    expect(bulk.status).toBe(200);
    expect(await bulk.json()).toEqual({
      updated_count: 1,
      updated_ids: [TEST_VIOLATION_ID],
    });
  });

  it("lists project and tenant violation summaries", async () => {
    const projectSummary = await buildApp(projectViolationListRouter).request(
      `/v1/projects/${TEST_PROJECT_ID}/violations/summary`,
    );
    expect(projectSummary.status).toBe(200);

    const projectList = await buildApp(projectViolationListRouter).request(
      `/v1/projects/${TEST_PROJECT_ID}/violations?limit=10&offset=0`,
    );
    expect(projectList.status).toBe(200);
    expect(await projectList.json()).toEqual({
      violations: [
        {
          id: TEST_VIOLATION_ID,
          entity_id: "npm:lodash:4.17.15",
          status: "open",
        },
      ],
      limit: 10,
      offset: 0,
    });

    const tenantSummary = await buildApp(tenantViolationSummaryRouter).request(
      `/v1/tenants/${TEST_TENANT_ID}/violations/summary`,
    );
    expect(tenantSummary.status).toBe(200);
    expect(await tenantSummary.json()).toEqual({ open: 4, formatted: true });
  });

  it("creates and deletes violation suppressions", async () => {
    const create = await buildApp(violationSuppressionWriteRouter).request(
      "/v1/violation-suppressions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: TEST_PROJECT_ID,
          entity_id: "npm:lodash:4.17.15",
          reason: "accepted risk",
        }),
      },
    );
    expect(create.status).toBe(201);

    const del = await buildApp(violationSuppressionWriteRouter).request(
      "/v1/violation-suppressions/00000000-0000-0000-0000-000000000123",
      { method: "DELETE" },
    );
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
  });
});
