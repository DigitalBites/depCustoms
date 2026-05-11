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
    execute: vi.fn(),
  },
}));

vi.mock("../../http/guards.js", () => ({
  getAuthContext: (c: any) => ({
    tenantId: c.get("tenantId"),
    userId: c.get("userId"),
    role: c.get("role"),
  }),
  listAccessibleProjectIds: vi.fn(async () => null),
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
  requireTenantCapabilityAccess: (
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
    return { ok: true, value: c.req.param("tenant_id") };
  },
}));

vi.mock("../../features/security/package-finding-context.js", () => ({
  loadProjectPackageFindingContext: vi.fn(),
}));

vi.mock("../../features/security/tenant-package-shared.js", () => ({
  loadTenantPackageContext: vi.fn(),
}));

vi.mock("../../features/security/finding-package-queries.js", () => ({
  loadProjectPackageEvidence: vi.fn(),
  loadTenantPackageEvidence: vi.fn(),
}));

import { Hono } from "hono";
import { db } from "../../db/index.js";
import {
  projectViolationEntityRouter,
  tenantViolationEntityRouter,
} from "../../features/violations/entity-routes.js";
import { loadProjectPackageFindingContext } from "../../features/security/package-finding-context.js";
import { loadTenantPackageContext } from "../../features/security/tenant-package-shared.js";
import {
  loadProjectPackageEvidence,
  loadTenantPackageEvidence,
} from "../../features/security/finding-package-queries.js";
import { listAccessibleProjectIds } from "../../http/guards.js";
import {
  q,
  TEST_PROJECT_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
} from "../helpers/fakes.js";

function buildApp(router: Hono, role = "owner", capabilityAllowed = true) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenantId", TEST_TENANT_ID);
    c.set("userId", TEST_USER_ID);
    c.set("role", role);
    c.set("capabilityAllowed", capabilityAllowed);
    await next();
  });
  app.route("/", router);
  return app;
}

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    package_id: "pkg-1",
    package_version_id: "pkgver-1",
    ecosystem: "npm",
    name: "lodash",
    version: "4.17.15",
    latest_evaluated_at: "2026-04-01T00:00:00Z",
    open_count: "2",
    resolved_count: "1",
    suppressed_count: "0",
    blocked_open_count: "1",
    advisory_open_count: "1",
    total_count: "1",
    ...overrides,
  };
}

function makeViolation(overrides: Record<string, unknown> = {}) {
  return {
    id: "vio-1",
    tenant_id: TEST_TENANT_ID,
    project_id: TEST_PROJECT_ID,
    package_id: "pkg-1",
    package_version_id: "pkgver-1",
    rule_name: "Block old lodash",
    policy_name: "Default",
    severity: "HIGH",
    message: "Blocked",
    enforcement_mode: "enforcing",
    blocked: true,
    status: "open",
    status_note: null,
    recommended_remediation: null,
    evaluated_at: new Date("2026-04-01T00:00:00Z"),
    first_seen_at: new Date("2026-04-01T00:00:00Z"),
    last_seen_at: new Date("2026-04-01T00:00:00Z"),
    project_name: "Main Project",
    ...overrides,
  };
}

function makeEvidence(overrides: Record<string, unknown> = {}) {
  return {
    package_id: "pkg-1",
    package_version_id: "pkgver-1",
    osv_cache_id: "cache-1",
    intelligence_cache_id: "intel-1",
    intelligence_nearest_match: "commander",
    intelligence_recommended_action: "review",
    intelligence_confidence: "high",
    intelligence_match_quality: "ambiguous",
    intelligence_candidate_trust: "high",
    intelligence_llm_verdict: "Possible typosquat.",
    intelligence_semantic_score: "0.566",
    intelligence_lexical_similarity_score: "0.778",
    osv_risk_tier: "HIGH",
    osv_finding_count: "2",
    osv_remediation_available: true,
    osv_best_remediation: "4.17.21",
    latest_version: "4.17.21",
    latest_version_published_at: "2026-04-02T00:00:00Z",
    contributor_cache_id: "contrib-1",
    contributor_tier: "HIGH",
    contributor_score: "83",
    publisher: "alice",
    publisher_seen_before_package: false,
    publisher_seen_count_before: "0",
    publisher_matches_prior_version: false,
    maintainer_set_changed: true,
    new_maintainer_count: "1",
    removed_maintainer_count: "0",
    maintainer_count: "2",
    has_install_scripts: true,
    has_provenance: true,
    has_trusted_publisher: false,
    release_velocity_7d: "1",
    release_velocity_30d: "2",
    history_complete: false,
    contributor_raw_factors: { publisher: 0.8 },
    contributor_last_scored_at: "2026-04-03T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.execute).mockResolvedValue([] as any);
  vi.mocked(db.select).mockReturnValue(q([]) as any);
  vi.mocked(loadProjectPackageFindingContext).mockResolvedValue({
    cacheFindings: [],
    entityContextRows: [],
  } as any);
  vi.mocked(loadTenantPackageContext).mockResolvedValue({
    cacheFindings: [],
    violationCountRows: [],
  } as any);
  vi.mocked(loadProjectPackageEvidence).mockResolvedValue([] as any);
  vi.mocked(loadTenantPackageEvidence).mockResolvedValue([] as any);
  vi.mocked(listAccessibleProjectIds).mockResolvedValue(["p-1", "p-2"] as any);
});

describe("violation entity routes", () => {
  it("returns an empty project entity page", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([] as any);

    const res = await buildApp(projectViolationEntityRouter).request(
      `/v1/projects/${TEST_PROJECT_ID}/violations/entities`,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entities: [],
      pagination: { limit: 50, offset: 0, total: 0 },
    });
  });

  it("returns project entity evidence with contributor and osv detail", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([makeSummary()] as any);
    vi.mocked(db.select).mockReturnValueOnce(q([makeViolation()]) as any);
    vi.mocked(db.select).mockReturnValueOnce(
      q([{ violation_id: "vio-1", count: "1" }]) as any,
    );
    vi.mocked(loadProjectPackageEvidence).mockResolvedValueOnce([
      makeEvidence(),
    ] as any);
    vi.mocked(loadProjectPackageFindingContext).mockResolvedValueOnce({
      cacheFindings: [
        {
          cacheId: "cache-1",
          findingId: "OSV-1",
          severity: "HIGH",
          title: "Prototype pollution",
          publishedAt: new Date("2026-03-20T00:00:00Z"),
          attributes: { attack_vector: "NETWORK" },
        },
      ],
      entityContextRows: [
        {
          package_version_id: "pkgver-1",
          dispositions: [
            { connectorKey: "osv", findingId: "OSV-1", status: "open" },
            {
              connectorKey: "intelligence",
              findingId: "typosquat_candidate",
              status: "open",
            },
          ],
          open_violation_count: "2",
        },
      ],
    } as any);

    const res = await buildApp(projectViolationEntityRouter, "owner").request(
      `/v1/projects/${TEST_PROJECT_ID}/violations/entities?status=open`,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.total).toBe(1);
    expect(body.entities[0]).toEqual(
      expect.objectContaining({
        packageVersionId: "pkgver-1",
        displayName: "npm:lodash@4.17.15",
        ecosystem: "npm",
        name: "lodash",
        version: "4.17.15",
        openCount: 2,
        highestSeverity: "HIGH",
        evidence: expect.objectContaining({
          osv: expect.objectContaining({
            hasFindings: true,
            networkExploitable: true,
            findingStatus: "open",
          }),
          intelligence: expect.objectContaining({
            hasFinding: true,
            nearestMatch: "commander",
            recommendedAction: "review",
            findingStatus: "open",
          }),
          contributor: expect.objectContaining({
            status: "ready",
            score: 83,
            hasFinding: true,
          }),
        }),
      }),
    );
    expect(body.entities[0].violations[0]).toEqual(
      expect.objectContaining({
        id: "vio-1",
        projectId: TEST_PROJECT_ID,
        projectName: "Main Project",
        severity: "HIGH",
        firstSeenAt: "2026-04-01T00:00:00.000Z",
        lastSeenAt: "2026-04-01T00:00:00.000Z",
        occurrenceCount: 1,
      }),
    );
  });

  it("returns a tenant entity page with deduped projects and suppressed status", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([
      makeSummary({
        open_count: "0",
        resolved_count: "0",
        suppressed_count: "1",
        blocked_open_count: "0",
        advisory_open_count: "0",
      }),
    ] as any);
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        makeViolation({
          status: "suppressed",
          blocked: false,
          severity: "LOW",
          project_id: "p-1",
          project_name: "Alpha",
        }),
        makeViolation({
          id: "vio-2",
          status: "suppressed",
          blocked: false,
          severity: "MEDIUM",
          project_id: "p-2",
          project_name: "Beta",
        }),
      ]) as any,
    );
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        { violation_id: "vio-1", count: "3" },
        { violation_id: "vio-2", count: "2" },
      ]) as any,
    );
    vi.mocked(loadTenantPackageEvidence).mockResolvedValueOnce([
      makeEvidence({ package_id: "pkg-1" }),
    ] as any);
    vi.mocked(loadTenantPackageContext).mockResolvedValueOnce({
      cacheFindings: [
        {
          cacheId: "cache-1",
          findingId: "OSV-2",
          severity: "MEDIUM",
          title: "Moderate issue",
          publishedAt: new Date("2026-03-22T00:00:00Z"),
          attributes: {},
        },
      ],
      violationCountRows: [],
    } as any);

    const res = await buildApp(tenantViolationEntityRouter, "admin").request(
      `/v1/tenants/${TEST_TENANT_ID}/violations/entities?status=suppressed`,
    );

    expect(res.status).toBe(200);
    expect(loadTenantPackageEvidence).toHaveBeenCalledWith(TEST_TENANT_ID, [
      "pkgver-1",
    ]);
    const body = await res.json();
    expect(body.entities[0]).toEqual(
      expect.objectContaining({
        highestSeverity: "NONE",
        projects: [
          { id: "p-1", name: "Alpha" },
          { id: "p-2", name: "Beta" },
        ],
        evidence: expect.objectContaining({
          osv: expect.objectContaining({
            hasFindings: true,
            highestSeverity: "HIGH",
          }),
          intelligence: expect.objectContaining({
            hasFinding: false,
            nearestMatch: "commander",
            recommendedAction: "review",
          }),
          contributor: expect.objectContaining({
            status: "ready",
            tier: "HIGH",
          }),
        }),
      }),
    );
  });
});
