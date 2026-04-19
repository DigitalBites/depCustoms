/**
 * RBAC security tests — verifies that member and guest roles cannot access
 * endpoints restricted to owner/admin, and that project-scoped endpoints
 * enforce project membership for member/guest callers.
 *
 * Auth strategy: mock authMiddleware to inject (tenantId, userId, role) directly.
 * Helper-backed project access paths are exercised by mocking the underlying DB lookups.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/index.js");
vi.mock("../../middleware/auth.js");
vi.mock("../../middleware/rbac.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../middleware/rbac.js")>();
  return {
    ...actual,
    checkProjectAccess: vi.fn(),
  };
});

import { Hono } from "hono";
import { db } from "../../db/index.js";
import { authMiddleware } from "../../middleware/auth.js";
import { checkProjectAccess } from "../../middleware/rbac.js";
import { performanceRouter } from "../../routes/performance.js";
import { violationsRouter } from "../../routes/violations.js";
import { securityRouter } from "../../routes/security.js";
import { tenantsRouter } from "../../routes/tenants.js";
import { connectorsRouter } from "../../routes/connectors.js";
import { policyPreviewRouter } from "../../routes/policy-preview.js";
import { violationSuppressionsRouter } from "../../routes/violation-suppressions.js";
import { packagesRouter } from "../../routes/packages.js";
import {
  q,
  fakeProject,
  fakeV2Policy,
  fakeViolation,
  TEST_TENANT_ID,
  TEST_PROJECT_ID,
  TEST_POLICY_ID,
  TEST_VIOLATION_ID,
} from "../helpers/fakes.js";

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
// Test apps
// ---------------------------------------------------------------------------

const perfApp = new Hono();
perfApp.route("/", performanceRouter);

const violationsApp = new Hono();
violationsApp.route("/", violationsRouter);

const securityApp = new Hono();
securityApp.route("/", securityRouter);

const tenantsApp = new Hono();
tenantsApp.route("/", tenantsRouter);

const connectorsApp = new Hono();
connectorsApp.route("/", connectorsRouter);

const policyPreviewApp = new Hono();
policyPreviewApp.route("/", policyPreviewRouter);

const violationSuppressionsApp = new Hono();
violationSuppressionsApp.route("/", violationSuppressionsRouter);

const packagesApp = new Hono();
packagesApp.route("/", packagesRouter);

beforeEach(() => {
  mockRole = "owner";
  vi.clearAllMocks();

  vi.mocked(authMiddleware).mockImplementation(async (c, next) => {
    c.set("tenantId", TEST_TENANT_ID);
    c.set("userId", "test-user-id");
    c.set("role", mockRole);
    await next();
  });

  // Default: checkProjectAccess grants access (owner/admin tests don't hit it)
  vi.mocked(checkProjectAccess).mockResolvedValue(true);

  vi.mocked(db.select).mockReturnValue(q([]) as any);
  vi.mocked(db.execute).mockResolvedValue([] as any);
  vi.mocked(db.insert).mockReturnValue(q(undefined) as any);
  vi.mocked(db.update).mockReturnValue(q(undefined) as any);
  vi.mocked(db.delete).mockReturnValue(q([]) as any);
});

// ---------------------------------------------------------------------------
// GET /v1/performance — owner/admin only
// ---------------------------------------------------------------------------

describe("GET /v1/performance — role enforcement", () => {
  it("returns 200 for demo", async () => {
    mockRole = "demo";
    vi.mocked(db.select).mockReturnValue(q([]) as any);
    const res = await perfApp.request("/v1/performance");
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it("returns 403 for member", async () => {
    mockRole = "member";
    const res = await perfApp.request("/v1/performance");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 for guest", async () => {
    mockRole = "guest";
    const res = await perfApp.request("/v1/performance");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("does not return 403 for owner (passes the role gate)", async () => {
    mockRole = "owner";
    // Performance route runs complex SQL aggregates; we only verify the role gate
    // passes (not 401/403) — the 200 success path is covered by integration tests.
    vi.mocked(db.select).mockReturnValue(q([]) as any);
    const res = await perfApp.request("/v1/performance");
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it("does not return 403 for admin (passes the role gate)", async () => {
    mockRole = "admin";
    vi.mocked(db.select).mockReturnValue(q([]) as any);
    const res = await perfApp.request("/v1/performance");
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/tenants/:tenant_id/violations/summary — tenant-wide read capability
// ---------------------------------------------------------------------------

describe("GET /v1/tenants/:tenant_id/violations/summary — role enforcement", () => {
  const url = `/v1/tenants/${TEST_TENANT_ID}/violations/summary`;

  it("does not return 403 for demo", async () => {
    mockRole = "demo";
    vi.mocked(db.select).mockReturnValue(q([]) as any);
    const res = await violationsApp.request(url);
    expect(res.status).not.toBe(403);
  });

  it("returns 403 for member", async () => {
    mockRole = "member";
    const res = await violationsApp.request(url);
    expect(res.status).toBe(403);
  });

  it("returns 403 for guest", async () => {
    mockRole = "guest";
    const res = await violationsApp.request(url);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/tenants/:tenant_id/violations — owner/admin only
// ---------------------------------------------------------------------------

describe("GET /v1/tenants/:tenant_id/violations — role enforcement", () => {
  const url = `/v1/tenants/${TEST_TENANT_ID}/violations`;

  it("returns 200 for demo", async () => {
    mockRole = "demo";
    vi.mocked(db.select).mockReturnValue(q([]) as any);

    const res = await violationsApp.request(url);
    expect(res.status).toBe(200);
  });

  it("returns 403 for member", async () => {
    mockRole = "member";
    const res = await violationsApp.request(url);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 for guest", async () => {
    mockRole = "guest";
    const res = await violationsApp.request(url);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------
// GET /v1/projects/:project_id/violations/summary — project membership required
// ---------------------------------------------------------------------------

describe("GET /v1/projects/:project_id/violations/summary — project access enforcement", () => {
  const url = `/v1/projects/${TEST_PROJECT_ID}/violations/summary`;

  it("returns 404 for member without project access", async () => {
    mockRole = "member";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await violationsApp.request(url);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 for guest without project access", async () => {
    mockRole = "guest";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await violationsApp.request(url);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 404 when project does not belong to tenant", async () => {
    mockRole = "member";
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any); // project not found

    const res = await violationsApp.request(url);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/projects/:project_id/violations — project membership required
// ---------------------------------------------------------------------------

describe("GET /v1/projects/:project_id/violations — project access enforcement", () => {
  const url = `/v1/projects/${TEST_PROJECT_ID}/violations`;

  it("returns 403 for member without project access", async () => {
    mockRole = "member";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await violationsApp.request(url);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 for guest without project access", async () => {
    mockRole = "guest";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await violationsApp.request(url);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 200 for member WITH project access", async () => {
    mockRole = "member";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any) // project lookup
      .mockReturnValueOnce(q([{ project_id: TEST_PROJECT_ID }]) as any) // membership lookup
      .mockReturnValueOnce(q([]) as any); // violations query

    const res = await violationsApp.request(url);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/violations/:violation_id — project membership required
// ---------------------------------------------------------------------------

describe("GET /v1/violations/:violation_id — project access enforcement", () => {
  const url = `/v1/violations/${TEST_VIOLATION_ID}`;

  it("returns 403 for member without access to the violation's project", async () => {
    mockRole = "member";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeViolation()]) as any)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await violationsApp.request(url);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 for guest without access to the violation's project", async () => {
    mockRole = "guest";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeViolation()]) as any)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await violationsApp.request(url);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 404 when violation does not belong to tenant", async () => {
    mockRole = "member";
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any); // violation not found

    const res = await violationsApp.request(url);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/tenants/:tenant_id/connectors/osv/summary — tenant-wide security read
// ---------------------------------------------------------------------------

describe("GET /v1/tenants/:tenant_id/connectors/osv/summary — role enforcement", () => {
  const url = `/v1/tenants/${TEST_TENANT_ID}/connectors/osv/summary`;

  it("does not return 403 for demo", async () => {
    mockRole = "demo";
    vi.mocked(db.select).mockReturnValue(q([]) as any);
    vi.mocked(db.execute).mockResolvedValue([] as any);
    const res = await securityApp.request(url);
    expect(res.status).not.toBe(403);
  });

  it("returns 403 for member", async () => {
    mockRole = "member";
    const res = await securityApp.request(url);
    expect(res.status).toBe(403);
  });

  it("returns 403 for guest", async () => {
    mockRole = "guest";
    const res = await securityApp.request(url);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/connectors — connectors.read required
// ---------------------------------------------------------------------------

describe("GET /v1/connectors — role enforcement", () => {
  const url = "/v1/connectors";

  it("does not return 403 for demo", async () => {
    mockRole = "demo";
    const res = await connectorsApp.request(url);
    expect(res.status).not.toBe(403);
  });

  it("does not return 403 for member", async () => {
    mockRole = "member";
    const res = await connectorsApp.request(url);
    expect(res.status).not.toBe(403);
  });

  it("returns 403 for guest", async () => {
    mockRole = "guest";
    const res = await connectorsApp.request(url);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/tenants/:tenant_id/violation-suppressions — tenant-wide read
// ---------------------------------------------------------------------------

describe("GET /v1/tenants/:tenant_id/violation-suppressions — role enforcement", () => {
  const url = `/v1/tenants/${TEST_TENANT_ID}/violation-suppressions`;

  it("does not return 403 for demo", async () => {
    mockRole = "demo";
    vi.mocked(db.select).mockReturnValue(q([]) as any);
    const res = await violationSuppressionsApp.request(url);
    expect(res.status).not.toBe(403);
  });

  it("returns 403 for member", async () => {
    mockRole = "member";
    const res = await violationSuppressionsApp.request(url);
    expect(res.status).toBe(403);
  });

  it("returns 403 for guest", async () => {
    mockRole = "guest";
    const res = await violationSuppressionsApp.request(url);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /v1/policies/:policy_id/validate — policy_preview.read required
// ---------------------------------------------------------------------------

describe("POST /v1/policies/:policy_id/validate — role enforcement", () => {
  const url = `/v1/policies/${TEST_POLICY_ID}/validate`;

  it("returns 403 for guest", async () => {
    mockRole = "guest";
    const res = await policyPreviewApp.request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        condition: { field: "asset.package", operator: "eq", value: "lodash" },
      }),
    });
    expect(res.status).toBe(403);
  });

  it("does not return 403 for member", async () => {
    mockRole = "member";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([{ id: TEST_POLICY_ID }]) as any)
      .mockReturnValueOnce(
        q([
          {
            canonical_ref: "asset.package",
            deprecated: false,
          },
        ]) as any,
      );

    const res = await policyPreviewApp.request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        condition: { field: "asset.package", operator: "eq", value: "lodash" },
      }),
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /v1/projects/:project_id/policy-preview — policy_preview.read required
// ---------------------------------------------------------------------------

describe("POST /v1/projects/:project_id/policy-preview — role enforcement", () => {
  const url = `/v1/projects/${TEST_PROJECT_ID}/policy-preview`;

  it("returns 403 for guest before project access resolution", async () => {
    mockRole = "guest";
    const res = await policyPreviewApp.request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ecosystem: "npm",
        package: "lodash",
        version: "4.17.21",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("does not return 403 for member with project access", async () => {
    mockRole = "member";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([{ project_id: TEST_PROJECT_ID }]) as any)
      .mockReturnValueOnce(
        q({
          policies: [fakeV2Policy({ project_id: TEST_PROJECT_ID })],
          allRules: [],
        }) as any,
      );

    const res = await policyPreviewApp.request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ecosystem: "npm",
        package: "lodash",
        version: "4.17.21",
      }),
    });
    expect(res.status).not.toBe(403);
  });

  it("returns 404 for member without project access", async () => {
    mockRole = "member";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await policyPreviewApp.request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ecosystem: "npm",
        package: "lodash",
        version: "4.17.21",
      }),
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/projects/:project_id/findings — security.read_project required
// ---------------------------------------------------------------------------

describe("GET /v1/projects/:project_id/findings — role enforcement", () => {
  const url = `/v1/projects/${TEST_PROJECT_ID}/findings`;

  it("returns 404 for guest when the project lookup finds nothing", async () => {
    mockRole = "guest";
    const res = await securityApp.request(url);
    expect(res.status).toBe(404);
  });

  it("does not return 403 for member with project access", async () => {
    mockRole = "member";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([{ project_id: TEST_PROJECT_ID }]) as any)
      .mockReturnValueOnce(q([]) as any)
      .mockReturnValueOnce(q([{ count: "0" }]) as any);

    const res = await securityApp.request(url);
    expect(res.status).not.toBe(403);
  });

  it("returns 403 for member without project access", async () => {
    mockRole = "member";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await securityApp.request(url);
    expect(res.status).toBe(403);
  });

  it("returns 403 for guest without project access", async () => {
    mockRole = "guest";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await securityApp.request(url);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/projects/:project_id/packages — project membership required
// ---------------------------------------------------------------------------

describe("GET /v1/projects/:project_id/packages — project access enforcement", () => {
  const url = `/v1/projects/${TEST_PROJECT_ID}/packages`;

  it("returns 404 for member without project access", async () => {
    mockRole = "member";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await packagesApp.request(url);
    expect(res.status).toBe(404);
  });

  it("returns 404 for guest without project access", async () => {
    mockRole = "guest";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await packagesApp.request(url);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/projects/:project_id/connectors/osv/packages — project membership required
// ---------------------------------------------------------------------------

describe("GET /v1/projects/:project_id/connectors/osv/packages — project access enforcement", () => {
  const url = `/v1/projects/${TEST_PROJECT_ID}/connectors/osv/packages`;

  it("returns 403 for member without project access", async () => {
    mockRole = "member";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await securityApp.request(url);
    expect(res.status).toBe(403);
  });

  it("returns 403 for guest without project access", async () => {
    mockRole = "guest";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await securityApp.request(url);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/projects/:project_id/connectors/osv/summary — project membership required
// ---------------------------------------------------------------------------

describe("GET /v1/projects/:project_id/connectors/osv/summary — project access enforcement", () => {
  const url = `/v1/projects/${TEST_PROJECT_ID}/connectors/osv/summary`;

  it("returns 403 for member without project access", async () => {
    mockRole = "member";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await securityApp.request(url);
    expect(res.status).toBe(403);
  });

  it("returns 403 for guest without project access", async () => {
    mockRole = "guest";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await securityApp.request(url);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/projects/:project_id/vulnerable-packages — project membership required
// ---------------------------------------------------------------------------

describe("GET /v1/projects/:project_id/vulnerable-packages — project access enforcement", () => {
  const url = `/v1/projects/${TEST_PROJECT_ID}/vulnerable-packages`;

  it("returns 403 for member without project access", async () => {
    mockRole = "member";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await securityApp.request(url);
    expect(res.status).toBe(403);
  });

  it("returns 403 for guest without project access", async () => {
    mockRole = "guest";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await securityApp.request(url);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/projects/:project_id/violation-suppressions — project membership required
// ---------------------------------------------------------------------------

describe("GET /v1/projects/:project_id/violation-suppressions — project access enforcement", () => {
  const url = `/v1/projects/${TEST_PROJECT_ID}/violation-suppressions`;

  it("returns 404 for member without project access", async () => {
    mockRole = "member";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await violationSuppressionsApp.request(url);
    expect(res.status).toBe(404);
  });

  it("returns 404 for guest without project access", async () => {
    mockRole = "guest";
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeProject()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const res = await violationSuppressionsApp.request(url);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/tenants/:tenant_id/connectors/osv/packages — owner/admin only
// ---------------------------------------------------------------------------

describe("GET /v1/tenants/:tenant_id/connectors/osv/packages — role enforcement", () => {
  const url = `/v1/tenants/${TEST_TENANT_ID}/connectors/osv/packages`;

  it("returns 403 for member", async () => {
    mockRole = "member";
    const res = await securityApp.request(url);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 for guest", async () => {
    mockRole = "guest";
    const res = await securityApp.request(url);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------
// GET /v1/tenants/:tenant_id/members — owner/admin only
// ---------------------------------------------------------------------------

describe("GET /v1/tenants/:tenant_id/members — role enforcement", () => {
  const url = `/v1/tenants/${TEST_TENANT_ID}/members`;

  it("returns 403 for member", async () => {
    mockRole = "member";
    const res = await tenantsApp.request(url);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 for guest", async () => {
    mockRole = "guest";
    const res = await tenantsApp.request(url);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });
});
