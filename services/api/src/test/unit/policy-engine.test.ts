/**
 * Unit tests for policy engine v2 pure functions:
 *   evaluateCondition, evaluateConditionWithTrace, renderTemplate (expression.ts)
 *   resolveFields, unavailableSnapshot (resolver.ts)
 *
 * Zero external dependencies — no DB, no network.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateCondition,
  evaluateConditionWithTrace,
  renderTemplate,
} from "../../policy/expression.js";
import { resolveFields, unavailableSnapshot } from "../../policy/resolver.js";
import type { ConnectorSnapshot } from "../../connectors/types.js";

// ---------------------------------------------------------------------------
// evaluateCondition — leaf nodes
// ---------------------------------------------------------------------------

describe("evaluateCondition — leaf operators", () => {
  it("eq: matches equal values", () => {
    expect(
      evaluateCondition({ field: "f", operator: "eq", value: 42 }, { f: 42 }),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "f", operator: "eq", value: 42 }, { f: 43 }),
    ).toBe(false);
  });

  it("ne: matches unequal values", () => {
    expect(
      evaluateCondition(
        { field: "f", operator: "ne", value: "HIGH" },
        { f: "LOW" },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: "f", operator: "ne", value: "HIGH" },
        { f: "HIGH" },
      ),
    ).toBe(false);
  });

  it("gt/gte/lt/lte: numeric comparisons", () => {
    expect(
      evaluateCondition({ field: "n", operator: "gt", value: 5 }, { n: 6 }),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "n", operator: "gt", value: 5 }, { n: 5 }),
    ).toBe(false);
    expect(
      evaluateCondition({ field: "n", operator: "gte", value: 5 }, { n: 5 }),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "n", operator: "lt", value: 5 }, { n: 4 }),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "n", operator: "lte", value: 5 }, { n: 5 }),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "n", operator: "lte", value: 5 }, { n: 6 }),
    ).toBe(false);
  });

  it("in / not_in: array membership", () => {
    expect(
      evaluateCondition(
        { field: "s", operator: "in", value: ["a", "b", "c"] },
        { s: "b" },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: "s", operator: "in", value: ["a", "b", "c"] },
        { s: "d" },
      ),
    ).toBe(false);
    expect(
      evaluateCondition(
        { field: "s", operator: "not_in", value: ["a", "b", "c"] },
        { s: "d" },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: "s", operator: "not_in", value: ["a", "b", "c"] },
        { s: "a" },
      ),
    ).toBe(false);
  });

  it("contains / not_contains / starts_with / ends_with", () => {
    expect(
      evaluateCondition(
        { field: "s", operator: "contains", value: "oo" },
        { s: "foobar" },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: "s", operator: "not_contains", value: "oo" },
        { s: "baz" },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: "s", operator: "starts_with", value: "foo" },
        { s: "foobar" },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: "s", operator: "ends_with", value: "bar" },
        { s: "foobar" },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: "s", operator: "ends_with", value: "baz" },
        { s: "foobar" },
      ),
    ).toBe(false);
  });

  it("is_true / is_false: boolean checks", () => {
    expect(
      evaluateCondition({ field: "b", operator: "is_true" }, { b: true }),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "b", operator: "is_true" }, { b: false }),
    ).toBe(false);
    expect(
      evaluateCondition({ field: "b", operator: "is_false" }, { b: false }),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "b", operator: "is_false" }, { b: true }),
    ).toBe(false);
  });

  it("exists / not_exists: null handling", () => {
    expect(
      evaluateCondition({ field: "x", operator: "exists" }, { x: "value" }),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "x", operator: "exists" }, { x: null }),
    ).toBe(false);
    expect(evaluateCondition({ field: "x", operator: "exists" }, {})).toBe(
      false,
    );
    expect(evaluateCondition({ field: "x", operator: "not_exists" }, {})).toBe(
      true,
    );
    expect(
      evaluateCondition({ field: "x", operator: "not_exists" }, { x: "v" }),
    ).toBe(false);
  });

  it("null field value: comparison operators return false", () => {
    expect(
      evaluateCondition(
        { field: "x", operator: "eq", value: null },
        { x: null },
      ),
    ).toBe(false);
    expect(
      evaluateCondition({ field: "x", operator: "gt", value: 5 }, {}),
    ).toBe(false);
    expect(
      evaluateCondition({ field: "x", operator: "in", value: ["a"] }, {}),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateCondition — logical groups
// ---------------------------------------------------------------------------

describe("evaluateCondition — logical groups", () => {
  const fields = { a: 1, b: "HIGH", c: true };

  it("all: AND — all must be true", () => {
    expect(
      evaluateCondition(
        {
          all: [
            { field: "a", operator: "eq", value: 1 },
            { field: "c", operator: "is_true" },
          ],
        },
        fields,
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        {
          all: [
            { field: "a", operator: "eq", value: 1 },
            { field: "a", operator: "gt", value: 5 },
          ],
        },
        fields,
      ),
    ).toBe(false);
  });

  it("any: OR — at least one must be true", () => {
    expect(
      evaluateCondition(
        {
          any: [
            { field: "a", operator: "eq", value: 99 },
            { field: "c", operator: "is_true" },
          ],
        },
        fields,
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        {
          any: [
            { field: "a", operator: "eq", value: 99 },
            { field: "a", operator: "eq", value: 88 },
          ],
        },
        fields,
      ),
    ).toBe(false);
  });

  it("not: negation", () => {
    expect(
      evaluateCondition(
        { not: { field: "a", operator: "eq", value: 99 } },
        fields,
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        { not: { field: "a", operator: "eq", value: 1 } },
        fields,
      ),
    ).toBe(false);
  });

  it("nested: any with an all clause inside", () => {
    expect(
      evaluateCondition(
        {
          any: [
            {
              all: [
                { field: "a", operator: "eq", value: 1 },
                { field: "b", operator: "eq", value: "HIGH" },
              ],
            },
            { field: "c", operator: "is_false" },
          ],
        },
        fields,
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateConditionWithTrace
// ---------------------------------------------------------------------------

describe("evaluateConditionWithTrace", () => {
  it("returns correct trace for leaf", () => {
    const { result, trace } = evaluateConditionWithTrace(
      { field: "x", operator: "gt", value: 5 },
      { x: 10 },
    );
    expect(result).toBe(true);
    expect(trace.node).toBe("leaf");
    expect(trace.resolved).toBe(10);
    expect(trace.field).toBe("x");
    expect(trace.operator).toBe("gt");
  });

  it("returns children for all/any", () => {
    const { trace } = evaluateConditionWithTrace(
      { all: [{ field: "a", operator: "eq", value: 1 }] },
      { a: 1 },
    );
    expect(trace.node).toBe("all");
    expect(trace.children).toHaveLength(1);
    expect(trace.children![0].node).toBe("leaf");
  });
});

// ---------------------------------------------------------------------------
// renderTemplate
// ---------------------------------------------------------------------------

describe("renderTemplate", () => {
  it("interpolates field references", () => {
    const fields = {
      "source.osv.critical_count": 3,
      "asset.package": "lodash",
    };
    const msg = renderTemplate(
      "Package {{asset.package}} has {{source.osv.critical_count}} critical CVEs",
      fields,
    );
    expect(msg).toBe("Package lodash has 3 critical CVEs");
  });

  it("renders ? for missing fields", () => {
    expect(renderTemplate("Status: {{x.y}}", {})).toBe("Status: ?");
  });
});

// ---------------------------------------------------------------------------
// resolveFields + unavailableSnapshot
// ---------------------------------------------------------------------------

describe("resolveFields", () => {
  const makeSnapshot = (
    overrides: Partial<ConnectorSnapshot> = {},
  ): ConnectorSnapshot => ({
    connectorKey: "osv",
    entityType: "artifact",
    entityId: "npm:lodash:4.17.15",
    fields: { critical_count: 2, max_severity: "HIGH" },
    meta: {
      status: "ok",
      responseTimeMs: 140,
      cacheAgeHours: null,
      isCacheHit: false,
    },
    observedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  it("populates asset built-in fields", () => {
    const fields = resolveFields([], {
      ecosystem: "npm",
      pkg: "lodash",
      version: "4.17.15",
    });
    expect(fields["asset.ecosystem"]).toBe("npm");
    expect(fields["asset.package"]).toBe("lodash");
    expect(fields["asset.version"]).toBe("4.17.15");
  });

  it("populates source data fields from snapshot", () => {
    const fields = resolveFields([makeSnapshot()], {
      ecosystem: "npm",
      pkg: "lodash",
      version: "4.17.15",
    });
    expect(fields["source.osv.critical_count"]).toBe(2);
    expect(fields["source.osv.max_severity"]).toBe("HIGH");
  });

  it("populates meta fields from snapshot", () => {
    const fields = resolveFields([makeSnapshot()], {
      ecosystem: "npm",
      pkg: "lodash",
      version: "4.17.15",
    });
    expect(fields["source.osv._meta.status"]).toBe("ok");
    expect(fields["source.osv._meta.response_time_ms"]).toBe(140);
    expect(fields["source.osv._meta.is_cache_hit"]).toBe(false);
  });

  it("failure snapshot: meta populated, data fields absent", () => {
    const failSnap = makeSnapshot({
      fields: {},
      meta: {
        status: "timeout",
        responseTimeMs: 2000,
        cacheAgeHours: null,
        isCacheHit: false,
      },
    });
    const fields = resolveFields([failSnap], {
      ecosystem: "npm",
      pkg: "lodash",
      version: "4.17.15",
    });
    expect(fields["source.osv._meta.status"]).toBe("timeout");
    expect(fields["source.osv.critical_count"]).toBeUndefined();
  });
});

describe("unavailableSnapshot", () => {
  it("returns a snapshot with status=unavailable and empty fields", () => {
    const snap = unavailableSnapshot("osv");
    expect(snap.connectorKey).toBe("osv");
    expect(snap.meta.status).toBe("unavailable");
    expect(snap.fields).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// End-to-end: OSV unavailability rule
// ---------------------------------------------------------------------------

describe("end-to-end: OSV availability rule", () => {
  const unavailabilityRule = {
    any: [
      {
        field: "source.osv._meta.status",
        operator: "in",
        value: ["timeout", "error", "unavailable"],
      },
      { field: "source.osv._meta.status", operator: "not_exists" },
    ],
  };

  it("triggers when connector is unavailable", () => {
    const fields = resolveFields([unavailableSnapshot("osv")], {
      ecosystem: "npm",
      pkg: "x",
      version: "1.0.0",
    });
    expect(evaluateCondition(unavailabilityRule, fields)).toBe(true);
  });

  it("does not trigger when connector is ok", () => {
    const fields = resolveFields(
      [
        {
          connectorKey: "osv",
          entityType: "artifact",
          entityId: "npm:x:1.0.0",
          fields: { critical_count: 0 },
          meta: {
            status: "ok",
            responseTimeMs: 100,
            cacheAgeHours: null,
            isCacheHit: false,
          },
          observedAt: "2026-01-01T00:00:00Z",
        },
      ],
      { ecosystem: "npm", pkg: "x", version: "1.0.0" },
    );
    expect(evaluateCondition(unavailabilityRule, fields)).toBe(false);
  });

  it("does not trigger on cache hit", () => {
    const fields = resolveFields(
      [
        {
          connectorKey: "osv",
          entityType: "artifact",
          entityId: "npm:x:1.0.0",
          fields: { critical_count: 0 },
          meta: {
            status: "cache_hit",
            responseTimeMs: 0,
            cacheAgeHours: 2.5,
            isCacheHit: true,
          },
          observedAt: "2026-01-01T00:00:00Z",
        },
      ],
      { ecosystem: "npm", pkg: "x", version: "1.0.0" },
    );
    expect(evaluateCondition(unavailabilityRule, fields)).toBe(false);
  });
});
