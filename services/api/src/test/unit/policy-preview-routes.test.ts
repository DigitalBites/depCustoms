import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    environment: "test",
  },
}));

vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("../../http/guards.js", () => ({
  getAuthContext: (c: any) => ({
    tenantId: c.get("tenantId"),
    userId: c.get("userId"),
    role: c.get("role"),
  }),
  requireProjectAccess: vi.fn(async (c: any) => ({
    projectId: c.req.param("project_id"),
    project: { id: c.req.param("project_id") },
  })),
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
}));

vi.mock("../../policy/effective.js", () => ({
  loadEffectivePolicy: vi.fn(),
  loadSnapshots: vi.fn(),
}));

vi.mock("../../policy/expression.js", () => ({
  evaluateConditionWithTrace: vi.fn(),
  renderTemplate: vi.fn((template: string) => template),
}));

vi.mock("../../policy/resolver.js", () => ({
  resolveFields: vi.fn(),
  unavailableSnapshot: vi.fn((key: string) => ({
    connectorKey: key,
    meta: { status: "unavailable", cacheAgeHours: null },
  })),
}));

vi.mock("../../connectors/cache.js", () => ({
  buildCachedSnapshot: vi.fn(),
}));

vi.mock("../../connectors/runtime.js", () => ({
  getConnectors: vi.fn(),
}));

import { Hono } from "hono";
import { db } from "../../db/index.js";
import { policyPreviewProjectRouter } from "../../features/policy-preview/project-routes.js";
import { policyPreviewPolicyRouter } from "../../features/policy-preview/policy-routes.js";
import { loadEffectivePolicy, loadSnapshots } from "../../policy/effective.js";
import { evaluateConditionWithTrace } from "../../policy/expression.js";
import { resolveFields } from "../../policy/resolver.js";
import { buildCachedSnapshot } from "../../connectors/cache.js";
import { getConnectors } from "../../connectors/runtime.js";
import {
  TEST_PROJECT_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
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
  vi.mocked(loadSnapshots).mockResolvedValue([]);
  vi.mocked(resolveFields).mockReturnValue({
    "source.osv.max_severity": "HIGH",
  } as any);
  vi.mocked(evaluateConditionWithTrace).mockReturnValue({
    result: true,
    trace: { op: "eq" },
  } as any);
});

describe("policy preview routes", () => {
  it("returns allow when a project has no active rules", async () => {
    vi.mocked(loadEffectivePolicy).mockResolvedValueOnce({
      policies: [],
      allRules: [],
    } as any);

    const res = await buildApp(policyPreviewProjectRouter).request(
      `/v1/projects/${TEST_PROJECT_ID}/policy-preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ecosystem: "npm",
          package: "lodash",
          version: "4.17.15",
        }),
      },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      decision: "allow",
      reason: "no_rules",
      detail: "No active rules configured",
      rules_evaluated: 0,
      rule_traces: [],
    });
  });

  it("evaluates project rules and returns a block decision", async () => {
    vi.mocked(loadEffectivePolicy).mockResolvedValueOnce({
      policies: [{ id: "pol-1" }],
      allRules: [
        {
          id: "rule-1",
          name: "Block high risk",
          condition: {
            field: "source.osv.max_severity",
            operator: "eq",
            value: "HIGH",
          },
          action: {
            type: "violation",
            code: "high_risk",
            message_template: "blocked",
          },
          effectiveEnforcementMode: "enforcing",
        },
      ],
    } as any);

    const res = await buildApp(policyPreviewProjectRouter).request(
      `/v1/projects/${TEST_PROJECT_ID}/policy-preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ecosystem: "npm",
          package: "lodash",
          version: "4.17.15",
          field_overrides: { "asset.package": "lodash" },
        }),
      },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        decision: "block",
        reason: "high_risk",
        blocked_by_rule_id: "rule-1",
        policies_evaluated: 1,
        rules_evaluated: 1,
        rules_matched: 1,
      }),
    );
  });

  it("validates policy conditions and surfaces warnings", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(q([{ id: "pol-1" }]) as any)
      .mockReturnValueOnce(
        q([
          { canonical_ref: "source.osv.max_severity", deprecated: true },
        ]) as any,
      );

    const res = await buildApp(policyPreviewPolicyRouter).request(
      "/v1/policies/00000000-0000-0000-0000-000000000123/validate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          condition: {
            all: [
              {
                field: "source.osv.max_severity",
                operator: "eq",
                value: "HIGH",
              },
              { field: "asset.package", operator: "eq", value: "lodash" },
              { field: "source.unknown.score", operator: "gt", value: 1 },
            ],
          },
        }),
      },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      valid: true,
      errors: [],
      warnings: expect.arrayContaining([expect.stringContaining("deprecated")]),
    });
  });

  it("previews a single rule against connector snapshots", async () => {
    vi.mocked(db.select).mockReturnValueOnce(q([{ id: "pol-1" }]) as any);
    vi.mocked(getConnectors).mockReturnValueOnce([
      { id: "osv" },
      { id: "contributor" },
    ] as any);
    vi.mocked(buildCachedSnapshot)
      .mockResolvedValueOnce({
        snapshot: {
          connectorKey: "osv",
          meta: { status: "cache_hit", cacheAgeHours: 2 },
        },
      } as any)
      .mockResolvedValueOnce(null as any);

    const res = await buildApp(policyPreviewPolicyRouter).request(
      "/v1/policies/00000000-0000-0000-0000-000000000123/rule-preview",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          condition: {
            field: "source.osv.max_severity",
            operator: "eq",
            value: "HIGH",
          },
          ecosystem: "npm",
          package: "lodash",
          version: "4.17.15",
        }),
      },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        matched: true,
        entity_id: "npm:lodash:4.17.15",
        connector_statuses: {
          osv: { status: "cache_hit", cache_age_hours: 2 },
        },
      }),
    );
  });
});
