/**
 * Comprehensive operator and logic tests for the policy expression engine.
 *
 * Covers every operator exposed to users, edge cases, logic equivalences
 * (De Morgan, identity, idempotency), and realistic end-to-end policy
 * scenarios drawn from real policy engine usage.
 *
 * Zero external dependencies — no DB, no network.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateCondition,
  evaluateConditionWithTrace,
  renderTemplate,
  type Condition,
} from "../../policy/expression.js";
import { resolveFields } from "../../policy/resolver.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand: evaluate a single leaf condition against a fields map. */
function leaf(
  field: string,
  operator: string,
  value?: unknown,
  fields: Record<string, unknown> = {},
): boolean {
  return evaluateCondition({ field, operator, value } as Condition, {
    [field]: fields[field] ?? fields["_"] ?? undefined,
    ...fields,
  });
}

function eval_(
  condition: Condition,
  fields: Record<string, unknown> = {},
): boolean {
  return evaluateCondition(condition, fields);
}

// ---------------------------------------------------------------------------
// eq — equality (loose ==)
// ---------------------------------------------------------------------------

describe("operator: eq", () => {
  it("matches equal numbers", () => {
    expect(eval_({ field: "n", operator: "eq", value: 42 }, { n: 42 })).toBe(
      true,
    );
  });

  it("does not match unequal numbers", () => {
    expect(eval_({ field: "n", operator: "eq", value: 42 }, { n: 43 })).toBe(
      false,
    );
  });

  it("matches equal strings", () => {
    expect(
      eval_({ field: "s", operator: "eq", value: "HIGH" }, { s: "HIGH" }),
    ).toBe(true);
  });

  it("does not match different strings", () => {
    expect(
      eval_({ field: "s", operator: "eq", value: "HIGH" }, { s: "CRITICAL" }),
    ).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(
      eval_({ field: "s", operator: "eq", value: "high" }, { s: "HIGH" }),
    ).toBe(false);
  });

  it('uses loose equality — string "42" equals number 42', () => {
    expect(eval_({ field: "n", operator: "eq", value: 42 }, { n: "42" })).toBe(
      true,
    );
  });

  it("returns false when field is null", () => {
    expect(eval_({ field: "n", operator: "eq", value: 0 }, { n: null })).toBe(
      false,
    );
  });

  it("returns false when field is missing", () => {
    expect(eval_({ field: "n", operator: "eq", value: 0 }, {})).toBe(false);
  });

  it("matches zero", () => {
    expect(eval_({ field: "n", operator: "eq", value: 0 }, { n: 0 })).toBe(
      true,
    );
  });

  it("matches empty string", () => {
    expect(eval_({ field: "s", operator: "eq", value: "" }, { s: "" })).toBe(
      true,
    );
  });

  it("matches boolean true", () => {
    expect(
      eval_({ field: "b", operator: "eq", value: true }, { b: true }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ne — inequality (loose !=)
// ---------------------------------------------------------------------------

describe("operator: ne", () => {
  it("matches when values differ", () => {
    expect(
      eval_({ field: "s", operator: "ne", value: "HIGH" }, { s: "LOW" }),
    ).toBe(true);
  });

  it("does not match when values are the same", () => {
    expect(
      eval_({ field: "s", operator: "ne", value: "HIGH" }, { s: "HIGH" }),
    ).toBe(false);
  });

  it("returns false when field is null (null field guard)", () => {
    // ne requires a non-null field value — missing field means no data to compare
    expect(eval_({ field: "n", operator: "ne", value: 99 }, { n: null })).toBe(
      false,
    );
  });

  it("returns false when field is missing", () => {
    expect(eval_({ field: "n", operator: "ne", value: 99 }, {})).toBe(false);
  });

  it('uses loose inequality — string "5" equals number 5, so ne returns false', () => {
    expect(eval_({ field: "n", operator: "ne", value: 5 }, { n: "5" })).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// gt — greater than
// ---------------------------------------------------------------------------

describe("operator: gt", () => {
  it("returns true when field exceeds value", () => {
    expect(eval_({ field: "n", operator: "gt", value: 5 }, { n: 6 })).toBe(
      true,
    );
  });

  it("returns false when field equals value (strict)", () => {
    expect(eval_({ field: "n", operator: "gt", value: 5 }, { n: 5 })).toBe(
      false,
    );
  });

  it("returns false when field is less than value", () => {
    expect(eval_({ field: "n", operator: "gt", value: 5 }, { n: 4 })).toBe(
      false,
    );
  });

  it("works with zero", () => {
    expect(eval_({ field: "n", operator: "gt", value: 0 }, { n: 1 })).toBe(
      true,
    );
    expect(eval_({ field: "n", operator: "gt", value: 0 }, { n: 0 })).toBe(
      false,
    );
  });

  it("works with negative numbers", () => {
    expect(eval_({ field: "n", operator: "gt", value: -10 }, { n: -5 })).toBe(
      true,
    );
    expect(eval_({ field: "n", operator: "gt", value: -5 }, { n: -10 })).toBe(
      false,
    );
  });

  it("works with floats", () => {
    expect(eval_({ field: "n", operator: "gt", value: 1.5 }, { n: 1.6 })).toBe(
      true,
    );
    expect(eval_({ field: "n", operator: "gt", value: 1.5 }, { n: 1.5 })).toBe(
      false,
    );
  });

  it("returns false when field is null", () => {
    expect(eval_({ field: "n", operator: "gt", value: 0 }, { n: null })).toBe(
      false,
    );
  });

  it("returns false when field is missing", () => {
    expect(eval_({ field: "n", operator: "gt", value: 0 }, {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// gte — greater than or equal
// ---------------------------------------------------------------------------

describe("operator: gte", () => {
  it("returns true when field exceeds value", () => {
    expect(eval_({ field: "n", operator: "gte", value: 5 }, { n: 6 })).toBe(
      true,
    );
  });

  it("returns true when field equals value", () => {
    expect(eval_({ field: "n", operator: "gte", value: 5 }, { n: 5 })).toBe(
      true,
    );
  });

  it("returns false when field is below value", () => {
    expect(eval_({ field: "n", operator: "gte", value: 5 }, { n: 4 })).toBe(
      false,
    );
  });

  it("works at zero boundary", () => {
    expect(eval_({ field: "n", operator: "gte", value: 0 }, { n: 0 })).toBe(
      true,
    );
    expect(eval_({ field: "n", operator: "gte", value: 0 }, { n: -1 })).toBe(
      false,
    );
  });

  it("returns false when field is null", () => {
    expect(eval_({ field: "n", operator: "gte", value: 0 }, { n: null })).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// lt — less than
// ---------------------------------------------------------------------------

describe("operator: lt", () => {
  it("returns true when field is below value", () => {
    expect(eval_({ field: "n", operator: "lt", value: 5 }, { n: 4 })).toBe(
      true,
    );
  });

  it("returns false when field equals value (strict)", () => {
    expect(eval_({ field: "n", operator: "lt", value: 5 }, { n: 5 })).toBe(
      false,
    );
  });

  it("returns false when field exceeds value", () => {
    expect(eval_({ field: "n", operator: "lt", value: 5 }, { n: 6 })).toBe(
      false,
    );
  });

  it("works with a 1-day age threshold", () => {
    // "block if package is newer than 1 day" → days_old lt 1
    expect(
      eval_({ field: "days_old", operator: "lt", value: 1 }, { days_old: 0 }),
    ).toBe(true);
    expect(
      eval_({ field: "days_old", operator: "lt", value: 1 }, { days_old: 1 }),
    ).toBe(false);
  });

  it("returns false when field is null", () => {
    expect(eval_({ field: "n", operator: "lt", value: 5 }, { n: null })).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// lte — less than or equal
// ---------------------------------------------------------------------------

describe("operator: lte", () => {
  it("returns true when field is below value", () => {
    expect(eval_({ field: "n", operator: "lte", value: 5 }, { n: 4 })).toBe(
      true,
    );
  });

  it("returns true when field equals value", () => {
    expect(eval_({ field: "n", operator: "lte", value: 5 }, { n: 5 })).toBe(
      true,
    );
  });

  it("returns false when field exceeds value", () => {
    expect(eval_({ field: "n", operator: "lte", value: 5 }, { n: 6 })).toBe(
      false,
    );
  });

  it("returns false when field is null", () => {
    expect(eval_({ field: "n", operator: "lte", value: 5 }, { n: null })).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// in — array membership
// ---------------------------------------------------------------------------

describe("operator: in", () => {
  it("returns true when field value is in the list", () => {
    expect(
      eval_(
        { field: "s", operator: "in", value: ["npm", "pypi", "cargo"] },
        { s: "npm" },
      ),
    ).toBe(true);
  });

  it("returns false when field value is not in the list", () => {
    expect(
      eval_(
        { field: "s", operator: "in", value: ["npm", "pypi"] },
        { s: "rubygems" },
      ),
    ).toBe(false);
  });

  it("returns false for an empty list", () => {
    expect(eval_({ field: "s", operator: "in", value: [] }, { s: "npm" })).toBe(
      false,
    );
  });

  it("works with a single-element list", () => {
    expect(
      eval_({ field: "s", operator: "in", value: ["npm"] }, { s: "npm" }),
    ).toBe(true);
    expect(
      eval_({ field: "s", operator: "in", value: ["npm"] }, { s: "pypi" }),
    ).toBe(false);
  });

  it("works with numbers", () => {
    expect(
      eval_({ field: "n", operator: "in", value: [1, 2, 3] }, { n: 2 }),
    ).toBe(true);
    expect(
      eval_({ field: "n", operator: "in", value: [1, 2, 3] }, { n: 4 }),
    ).toBe(false);
  });

  it("returns false when condition value is not an array", () => {
    expect(
      eval_({ field: "s", operator: "in", value: "npm" }, { s: "npm" }),
    ).toBe(false);
  });

  it("returns false when field is null", () => {
    expect(
      eval_({ field: "s", operator: "in", value: ["npm"] }, { s: null }),
    ).toBe(false);
  });

  it("returns false when field is missing", () => {
    expect(eval_({ field: "s", operator: "in", value: ["npm"] }, {})).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// not_in — array non-membership
// ---------------------------------------------------------------------------

describe("operator: not_in", () => {
  it("returns true when field value is not in the list", () => {
    expect(
      eval_(
        { field: "s", operator: "not_in", value: ["npm", "pypi"] },
        { s: "cargo" },
      ),
    ).toBe(true);
  });

  it("returns false when field value is in the list", () => {
    expect(
      eval_(
        { field: "s", operator: "not_in", value: ["npm", "pypi"] },
        { s: "npm" },
      ),
    ).toBe(false);
  });

  it("returns true for an empty list (nothing to exclude)", () => {
    expect(
      eval_({ field: "s", operator: "not_in", value: [] }, { s: "npm" }),
    ).toBe(true);
  });

  it("returns false when condition value is not an array", () => {
    expect(
      eval_({ field: "s", operator: "not_in", value: "npm" }, { s: "pypi" }),
    ).toBe(false);
  });

  it("returns false when field is null", () => {
    expect(
      eval_({ field: "s", operator: "not_in", value: ["npm"] }, { s: null }),
    ).toBe(false);
  });

  it("returns false when field is missing", () => {
    expect(eval_({ field: "s", operator: "not_in", value: ["npm"] }, {})).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// contains / not_contains
// ---------------------------------------------------------------------------

describe("operator: contains", () => {
  it("returns true when string includes the substring", () => {
    expect(
      eval_({ field: "s", operator: "contains", value: "oo" }, { s: "foobar" }),
    ).toBe(true);
  });

  it("returns false when string does not include the substring", () => {
    expect(
      eval_(
        { field: "s", operator: "contains", value: "xyz" },
        { s: "foobar" },
      ),
    ).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(
      eval_(
        { field: "s", operator: "contains", value: "FOO" },
        { s: "foobar" },
      ),
    ).toBe(false);
  });

  it("empty substring is always contained", () => {
    expect(
      eval_({ field: "s", operator: "contains", value: "" }, { s: "anything" }),
    ).toBe(true);
  });

  it("matches at start of string", () => {
    expect(
      eval_(
        { field: "s", operator: "contains", value: "foo" },
        { s: "foobar" },
      ),
    ).toBe(true);
  });

  it("matches at end of string", () => {
    expect(
      eval_(
        { field: "s", operator: "contains", value: "bar" },
        { s: "foobar" },
      ),
    ).toBe(true);
  });

  it("returns false when field is a number (not a string)", () => {
    expect(
      eval_({ field: "n", operator: "contains", value: "4" }, { n: 42 }),
    ).toBe(false);
  });

  it("returns false when field is null", () => {
    expect(
      eval_({ field: "s", operator: "contains", value: "x" }, { s: null }),
    ).toBe(false);
  });
});

describe("operator: not_contains", () => {
  it("returns true when string does not include the substring", () => {
    expect(
      eval_(
        { field: "s", operator: "not_contains", value: "xyz" },
        { s: "foobar" },
      ),
    ).toBe(true);
  });

  it("returns false when string includes the substring", () => {
    expect(
      eval_(
        { field: "s", operator: "not_contains", value: "foo" },
        { s: "foobar" },
      ),
    ).toBe(false);
  });

  it("returns false when field is null", () => {
    expect(
      eval_({ field: "s", operator: "not_contains", value: "x" }, { s: null }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// starts_with / ends_with
// ---------------------------------------------------------------------------

describe("operator: starts_with", () => {
  it("returns true when string starts with prefix", () => {
    expect(
      eval_(
        { field: "s", operator: "starts_with", value: "foo" },
        { s: "foobar" },
      ),
    ).toBe(true);
  });

  it("returns false when string does not start with prefix", () => {
    expect(
      eval_(
        { field: "s", operator: "starts_with", value: "bar" },
        { s: "foobar" },
      ),
    ).toBe(false);
  });

  it("matches the full string", () => {
    expect(
      eval_(
        { field: "s", operator: "starts_with", value: "foobar" },
        { s: "foobar" },
      ),
    ).toBe(true);
  });

  it("empty prefix matches everything", () => {
    expect(
      eval_(
        { field: "s", operator: "starts_with", value: "" },
        { s: "anything" },
      ),
    ).toBe(true);
  });

  it("is case-sensitive", () => {
    expect(
      eval_(
        { field: "s", operator: "starts_with", value: "FOO" },
        { s: "foobar" },
      ),
    ).toBe(false);
  });

  it("returns false when field is null", () => {
    expect(
      eval_({ field: "s", operator: "starts_with", value: "f" }, { s: null }),
    ).toBe(false);
  });

  it("returns false when field is not a string", () => {
    expect(
      eval_({ field: "n", operator: "starts_with", value: "4" }, { n: 42 }),
    ).toBe(false);
  });
});

describe("operator: ends_with", () => {
  it("returns true when string ends with suffix", () => {
    expect(
      eval_(
        { field: "s", operator: "ends_with", value: "bar" },
        { s: "foobar" },
      ),
    ).toBe(true);
  });

  it("returns false when string does not end with suffix", () => {
    expect(
      eval_(
        { field: "s", operator: "ends_with", value: "foo" },
        { s: "foobar" },
      ),
    ).toBe(false);
  });

  it("matches the full string", () => {
    expect(
      eval_(
        { field: "s", operator: "ends_with", value: "foobar" },
        { s: "foobar" },
      ),
    ).toBe(true);
  });

  it("empty suffix matches everything", () => {
    expect(
      eval_(
        { field: "s", operator: "ends_with", value: "" },
        { s: "anything" },
      ),
    ).toBe(true);
  });

  it("is case-sensitive", () => {
    expect(
      eval_(
        { field: "s", operator: "ends_with", value: "BAR" },
        { s: "foobar" },
      ),
    ).toBe(false);
  });

  it("returns false when field is null", () => {
    expect(
      eval_({ field: "s", operator: "ends_with", value: "r" }, { s: null }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// is_true / is_false — strict boolean checks
// ---------------------------------------------------------------------------

describe("operator: is_true", () => {
  it("returns true for boolean true", () => {
    expect(eval_({ field: "b", operator: "is_true" }, { b: true })).toBe(true);
  });

  it("returns false for boolean false", () => {
    expect(eval_({ field: "b", operator: "is_true" }, { b: false })).toBe(
      false,
    );
  });

  it("returns false for truthy non-boolean values (strict check)", () => {
    expect(eval_({ field: "b", operator: "is_true" }, { b: 1 })).toBe(false);
    expect(eval_({ field: "b", operator: "is_true" }, { b: "true" })).toBe(
      false,
    );
    expect(eval_({ field: "b", operator: "is_true" }, { b: [] })).toBe(false);
  });

  it("returns true even when field is null (no null guard for boolean ops)", () => {
    // is_true / is_false check fieldValue === true/false, so null fails the check
    expect(eval_({ field: "b", operator: "is_true" }, { b: null })).toBe(false);
  });

  it("returns false when field is missing", () => {
    expect(eval_({ field: "b", operator: "is_true" }, {})).toBe(false);
  });
});

describe("operator: is_false", () => {
  it("returns true for boolean false", () => {
    expect(eval_({ field: "b", operator: "is_false" }, { b: false })).toBe(
      true,
    );
  });

  it("returns false for boolean true", () => {
    expect(eval_({ field: "b", operator: "is_false" }, { b: true })).toBe(
      false,
    );
  });

  it("returns false for falsy non-boolean values (strict check)", () => {
    expect(eval_({ field: "b", operator: "is_false" }, { b: 0 })).toBe(false);
    expect(eval_({ field: "b", operator: "is_false" }, { b: "" })).toBe(false);
    expect(eval_({ field: "b", operator: "is_false" }, { b: null })).toBe(
      false,
    );
  });

  it("returns false when field is missing", () => {
    expect(eval_({ field: "b", operator: "is_false" }, {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// exists / not_exists — presence checks
// ---------------------------------------------------------------------------

describe("operator: exists", () => {
  it("returns true for a string value", () => {
    expect(eval_({ field: "x", operator: "exists" }, { x: "hello" })).toBe(
      true,
    );
  });

  it("returns true for a number value including zero", () => {
    expect(eval_({ field: "x", operator: "exists" }, { x: 0 })).toBe(true);
  });

  it("returns true for boolean false (it exists, it is just false)", () => {
    expect(eval_({ field: "x", operator: "exists" }, { x: false })).toBe(true);
  });

  it("returns true for an empty string (it exists)", () => {
    expect(eval_({ field: "x", operator: "exists" }, { x: "" })).toBe(true);
  });

  it("returns false for null", () => {
    expect(eval_({ field: "x", operator: "exists" }, { x: null })).toBe(false);
  });

  it("returns false when field is missing from the map", () => {
    expect(eval_({ field: "x", operator: "exists" }, {})).toBe(false);
  });
});

describe("operator: not_exists", () => {
  it("returns true when field is missing", () => {
    expect(eval_({ field: "x", operator: "not_exists" }, {})).toBe(true);
  });

  it("returns true when field is null", () => {
    expect(eval_({ field: "x", operator: "not_exists" }, { x: null })).toBe(
      true,
    );
  });

  it("returns false when field has a value", () => {
    expect(eval_({ field: "x", operator: "not_exists" }, { x: "value" })).toBe(
      false,
    );
  });

  it("returns false for zero (zero is a value)", () => {
    expect(eval_({ field: "x", operator: "not_exists" }, { x: 0 })).toBe(false);
  });

  it("returns false for boolean false", () => {
    expect(eval_({ field: "x", operator: "not_exists" }, { x: false })).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Unknown operator
// ---------------------------------------------------------------------------

describe("unknown operator", () => {
  it("returns false for unrecognised operator names", () => {
    expect(
      eval_({ field: "x", operator: "regex", value: ".*" }, { x: "anything" }),
    ).toBe(false);
    expect(eval_({ field: "x", operator: "", value: "x" }, { x: "x" })).toBe(
      false,
    );
    expect(
      eval_({ field: "x", operator: "EQUALS", value: "x" }, { x: "x" }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Logical group: all (AND)
// ---------------------------------------------------------------------------

describe("logical group: all (AND)", () => {
  it("returns true when all conditions pass", () => {
    expect(
      eval_(
        {
          all: [
            { field: "a", operator: "eq", value: 1 },
            { field: "b", operator: "eq", value: 2 },
          ],
        },
        { a: 1, b: 2 },
      ),
    ).toBe(true);
  });

  it("returns false when any condition fails", () => {
    expect(
      eval_(
        {
          all: [
            { field: "a", operator: "eq", value: 1 },
            { field: "b", operator: "eq", value: 99 },
          ],
        },
        { a: 1, b: 2 },
      ),
    ).toBe(false);
  });

  it("returns false when the first condition fails (short-circuit)", () => {
    expect(
      eval_(
        {
          all: [
            { field: "a", operator: "eq", value: 99 },
            { field: "b", operator: "eq", value: 2 },
          ],
        },
        { a: 1, b: 2 },
      ),
    ).toBe(false);
  });

  it("vacuous truth: empty all is true", () => {
    expect(eval_({ all: [] }, {})).toBe(true);
  });

  it("single-condition all behaves like the condition itself", () => {
    expect(
      eval_({ all: [{ field: "x", operator: "gt", value: 0 }] }, { x: 5 }),
    ).toBe(true);
    expect(
      eval_({ all: [{ field: "x", operator: "gt", value: 0 }] }, { x: -1 }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Logical group: any (OR)
// ---------------------------------------------------------------------------

describe("logical group: any (OR)", () => {
  it("returns true when at least one condition passes", () => {
    expect(
      eval_(
        {
          any: [
            { field: "a", operator: "eq", value: 99 },
            { field: "b", operator: "eq", value: 2 },
          ],
        },
        { a: 1, b: 2 },
      ),
    ).toBe(true);
  });

  it("returns false when no conditions pass", () => {
    expect(
      eval_(
        {
          any: [
            { field: "a", operator: "eq", value: 99 },
            { field: "b", operator: "eq", value: 88 },
          ],
        },
        { a: 1, b: 2 },
      ),
    ).toBe(false);
  });

  it("returns true when all conditions pass", () => {
    expect(
      eval_(
        {
          any: [
            { field: "a", operator: "eq", value: 1 },
            { field: "b", operator: "eq", value: 2 },
          ],
        },
        { a: 1, b: 2 },
      ),
    ).toBe(true);
  });

  it("vacuous false: empty any is false", () => {
    expect(eval_({ any: [] }, {})).toBe(false);
  });

  it("single-condition any behaves like the condition itself", () => {
    expect(
      eval_({ any: [{ field: "x", operator: "gt", value: 0 }] }, { x: 5 }),
    ).toBe(true);
    expect(
      eval_({ any: [{ field: "x", operator: "gt", value: 0 }] }, { x: -1 }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Logical group: not
// ---------------------------------------------------------------------------

describe("logical group: not", () => {
  it("negates a true leaf to false", () => {
    expect(
      eval_({ not: { field: "a", operator: "eq", value: 1 } }, { a: 1 }),
    ).toBe(false);
  });

  it("negates a false leaf to true", () => {
    expect(
      eval_({ not: { field: "a", operator: "eq", value: 99 } }, { a: 1 }),
    ).toBe(true);
  });

  it("double negation is identity", () => {
    const inner: Condition = { field: "x", operator: "gt", value: 5 };
    const fields = { x: 10 };
    expect(eval_({ not: { not: inner } }, fields)).toBe(eval_(inner, fields));
  });

  it("not of an all group", () => {
    expect(
      eval_(
        {
          not: {
            all: [
              { field: "a", operator: "eq", value: 1 },
              { field: "b", operator: "eq", value: 2 },
            ],
          },
        },
        { a: 1, b: 99 },
      ),
    ).toBe(true); // the all fails, so not(all) is true

    expect(
      eval_(
        {
          not: {
            all: [
              { field: "a", operator: "eq", value: 1 },
              { field: "b", operator: "eq", value: 2 },
            ],
          },
        },
        { a: 1, b: 2 },
      ),
    ).toBe(false); // the all passes, so not(all) is false
  });

  it("not of an any group", () => {
    expect(
      eval_(
        {
          not: {
            any: [
              { field: "a", operator: "eq", value: 99 },
              { field: "b", operator: "eq", value: 88 },
            ],
          },
        },
        { a: 1, b: 2 },
      ),
    ).toBe(true); // any fails, not(any) is true
  });
});

// ---------------------------------------------------------------------------
// Logic equivalences
// ---------------------------------------------------------------------------

describe("logic equivalences", () => {
  const fields = { a: 1, b: 10 };
  const A: Condition = { field: "a", operator: "eq", value: 1 }; // true
  const B: Condition = { field: "b", operator: "gt", value: 5 }; // true
  const C: Condition = { field: "a", operator: "gt", value: 99 }; // false

  it("De Morgan: not(A and B) == not(A) or not(B)", () => {
    const lhs = eval_({ not: { all: [A, B] } }, fields);
    const rhs = eval_({ any: [{ not: A }, { not: B }] }, fields);
    expect(lhs).toBe(rhs);
  });

  it("De Morgan: not(A or B) == not(A) and not(B)", () => {
    const lhs = eval_({ not: { any: [A, C] } }, fields);
    const rhs = eval_({ all: [{ not: A }, { not: C }] }, fields);
    expect(lhs).toBe(rhs);
  });

  it("identity: A and true == A", () => {
    // all([]) is vacuously true
    expect(eval_({ all: [A, { all: [] }] }, fields)).toBe(eval_(A, fields));
  });

  it("identity: A or false == A", () => {
    // any([]) is false
    expect(eval_({ any: [A, { any: [] }] }, fields)).toBe(eval_(A, fields));
  });

  it("annihilator: A or true == true", () => {
    expect(eval_({ any: [C, { all: [] }] }, fields)).toBe(true);
  });

  it("annihilator: A and false == false", () => {
    expect(eval_({ all: [A, { any: [] }] }, fields)).toBe(false);
  });

  it("idempotency: evaluating the same condition twice gives the same result", () => {
    const cond: Condition = { all: [A, { any: [B, C] }] };
    expect(eval_(cond, fields)).toBe(eval_(cond, fields));
  });
});

// ---------------------------------------------------------------------------
// Nesting — multi-level groups
// ---------------------------------------------------------------------------

describe("nesting", () => {
  it("any containing an all: (A and B) or C", () => {
    const fields = { a: 1, b: 2, c: 99 };
    expect(
      eval_(
        {
          any: [
            {
              all: [
                { field: "a", operator: "eq", value: 1 },
                { field: "b", operator: "eq", value: 2 },
              ],
            },
            { field: "c", operator: "eq", value: 0 },
          ],
        },
        fields,
      ),
    ).toBe(true);
  });

  it("all containing an any: A and (B or C)", () => {
    const fields = { a: 1, b: 99, c: 3 };
    expect(
      eval_(
        {
          all: [
            { field: "a", operator: "eq", value: 1 },
            {
              any: [
                { field: "b", operator: "eq", value: 2 },
                { field: "c", operator: "eq", value: 3 },
              ],
            },
          ],
        },
        fields,
      ),
    ).toBe(true);
  });

  it("not inside all: A and not(B)", () => {
    const fields = { a: 1, b: 5 };
    expect(
      eval_(
        {
          all: [
            { field: "a", operator: "eq", value: 1 },
            { not: { field: "b", operator: "eq", value: 99 } },
          ],
        },
        fields,
      ),
    ).toBe(true);
  });

  it("three levels deep: not(any([all([A, B]), C]))", () => {
    const fields = { a: 1, b: 2, c: 99 };
    // inner all: a==1 && b==2 → true; any([true, c==0→false]) → true; not(true) → false
    expect(
      eval_(
        {
          not: {
            any: [
              {
                all: [
                  { field: "a", operator: "eq", value: 1 },
                  { field: "b", operator: "eq", value: 2 },
                ],
              },
              { field: "c", operator: "eq", value: 0 },
            ],
          },
        },
        fields,
      ),
    ).toBe(false);
  });

  it("deeply nested all of alls", () => {
    expect(
      eval_(
        {
          all: [
            { all: [{ field: "x", operator: "gt", value: 0 }] },
            { all: [{ field: "y", operator: "lt", value: 100 }] },
          ],
        },
        { x: 5, y: 50 },
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateConditionWithTrace — trace structure correctness
// ---------------------------------------------------------------------------

describe("evaluateConditionWithTrace", () => {
  it("leaf trace captures field, operator, value, and resolved", () => {
    const { result, trace } = evaluateConditionWithTrace(
      { field: "source.osv.critical_count", operator: "gt", value: 0 },
      { "source.osv.critical_count": 3 },
    );
    expect(result).toBe(true);
    expect(trace.node).toBe("leaf");
    expect(trace.field).toBe("source.osv.critical_count");
    expect(trace.operator).toBe("gt");
    expect(trace.value).toBe(0);
    expect(trace.resolved).toBe(3);
    expect(trace.result).toBe(true);
  });

  it("leaf trace resolved is null for missing field", () => {
    const { result, trace } = evaluateConditionWithTrace(
      { field: "missing", operator: "gt", value: 0 },
      {},
    );
    expect(result).toBe(false);
    expect(trace.resolved).toBeNull();
  });

  it("all trace has node=all and children for each sub-condition", () => {
    const { trace } = evaluateConditionWithTrace(
      {
        all: [
          { field: "a", operator: "eq", value: 1 },
          { field: "b", operator: "eq", value: 2 },
        ],
      },
      { a: 1, b: 2 },
    );
    expect(trace.node).toBe("all");
    expect(trace.result).toBe(true);
    expect(trace.children).toHaveLength(2);
    expect(trace.children![0].node).toBe("leaf");
    expect(trace.children![1].node).toBe("leaf");
  });

  it("any trace reflects which branch passed", () => {
    const { trace } = evaluateConditionWithTrace(
      {
        any: [
          { field: "a", operator: "eq", value: 99 }, // false
          { field: "b", operator: "eq", value: 2 }, // true
        ],
      },
      { a: 1, b: 2 },
    );
    expect(trace.node).toBe("any");
    expect(trace.result).toBe(true);
    expect(trace.children![0].result).toBe(false);
    expect(trace.children![1].result).toBe(true);
  });

  it("not trace has one child and inverted result", () => {
    const { trace } = evaluateConditionWithTrace(
      { not: { field: "x", operator: "eq", value: 1 } },
      { x: 1 },
    );
    expect(trace.node).toBe("not");
    expect(trace.result).toBe(false);
    expect(trace.children).toHaveLength(1);
    expect(trace.children![0].result).toBe(true);
  });

  it("trace result matches evaluateCondition result", () => {
    const condition: Condition = {
      all: [
        { field: "n", operator: "gt", value: 0 },
        { not: { field: "s", operator: "in", value: ["bad", "worse"] } },
      ],
    };
    const fields = { n: 3, s: "ok" };
    const direct = evaluateCondition(condition, fields);
    const { result } = evaluateConditionWithTrace(condition, fields);
    expect(result).toBe(direct);
  });
});

// ---------------------------------------------------------------------------
// renderTemplate — field interpolation
// ---------------------------------------------------------------------------

describe("renderTemplate", () => {
  it("interpolates a single field reference", () => {
    expect(
      renderTemplate("Package {{asset.package}}", {
        "asset.package": "lodash",
      }),
    ).toBe("Package lodash");
  });

  it("interpolates multiple references", () => {
    expect(
      renderTemplate(
        "{{asset.package}}@{{asset.version}} has {{source.osv.critical_count}} critical CVEs",
        {
          "asset.package": "lodash",
          "asset.version": "4.17.20",
          "source.osv.critical_count": 2,
        },
      ),
    ).toBe("lodash@4.17.20 has 2 critical CVEs");
  });

  it("interpolates the same reference appearing twice", () => {
    expect(renderTemplate("{{x}} and {{x}}", { x: "hello" })).toBe(
      "hello and hello",
    );
  });

  it("renders ? for a missing field reference", () => {
    expect(renderTemplate("Status: {{missing.field}}", {})).toBe("Status: ?");
  });

  it("renders ? for an explicitly null field", () => {
    expect(renderTemplate("Count: {{n}}", { n: null })).toBe("Count: ?");
  });

  it("renders numeric and boolean values as strings", () => {
    expect(
      renderTemplate("Count: {{n}}, Flag: {{b}}", { n: 42, b: true }),
    ).toBe("Count: 42, Flag: true");
  });

  it("passes through a template with no references unchanged", () => {
    expect(renderTemplate("No references here.", {})).toBe(
      "No references here.",
    );
  });

  it("handles whitespace inside {{ }} references", () => {
    expect(
      renderTemplate("{{ asset.package }}", { "asset.package": "express" }),
    ).toBe("express");
  });
});

// ---------------------------------------------------------------------------
// End-to-end: realistic policy scenarios using resolveFields
// ---------------------------------------------------------------------------

describe("scenario: block packages with critical CVEs", () => {
  const rule: Condition = {
    field: "source.osv.critical_count",
    operator: "gt",
    value: 0,
  };

  it("fires when critical_count is 1", () => {
    const fields = resolveFields(
      [
        {
          connectorKey: "osv",
          entityType: "artifact",
          entityId: "npm:pkg:1.0.0",
          fields: { critical_count: 1 },
          meta: {
            status: "ok",
            responseTimeMs: 50,
            cacheAgeHours: null,
            isCacheHit: false,
          },
          observedAt: "2026-01-01T00:00:00Z",
        },
      ],
      { ecosystem: "npm", pkg: "pkg", version: "1.0.0" },
    );
    expect(evaluateCondition(rule, fields)).toBe(true);
  });

  it("does not fire when critical_count is 0", () => {
    const fields = resolveFields(
      [
        {
          connectorKey: "osv",
          entityType: "artifact",
          entityId: "npm:pkg:1.0.0",
          fields: { critical_count: 0 },
          meta: {
            status: "ok",
            responseTimeMs: 50,
            cacheAgeHours: null,
            isCacheHit: false,
          },
          observedAt: "2026-01-01T00:00:00Z",
        },
      ],
      { ecosystem: "npm", pkg: "pkg", version: "1.0.0" },
    );
    expect(evaluateCondition(rule, fields)).toBe(false);
  });

  it("does not fire when connector data is absent (null field guard)", () => {
    const fields = resolveFields(
      [
        {
          connectorKey: "osv",
          entityType: "artifact",
          entityId: "npm:pkg:1.0.0",
          fields: {},
          meta: {
            status: "timeout",
            responseTimeMs: 2000,
            cacheAgeHours: null,
            isCacheHit: false,
          },
          observedAt: "2026-01-01T00:00:00Z",
        },
      ],
      { ecosystem: "npm", pkg: "pkg", version: "1.0.0" },
    );
    expect(evaluateCondition(rule, fields)).toBe(false);
  });
});

describe("scenario: block disallowed ecosystems", () => {
  const rule: Condition = {
    not: { field: "asset.ecosystem", operator: "in", value: ["npm", "pypi"] },
  };

  it("fires for cargo (not in allowlist)", () => {
    const fields = resolveFields([], {
      ecosystem: "cargo",
      pkg: "serde",
      version: "1.0.0",
    });
    expect(evaluateCondition(rule, fields)).toBe(true);
  });

  it("does not fire for npm (in allowlist)", () => {
    const fields = resolveFields([], {
      ecosystem: "npm",
      pkg: "lodash",
      version: "4.17.15",
    });
    expect(evaluateCondition(rule, fields)).toBe(false);
  });
});

describe("scenario: block known malicious packages", () => {
  const rule: Condition = {
    field: "asset.package",
    operator: "in",
    value: ["event-stream", "flatmap-stream", "node-ipc"],
  };

  it("fires for a known bad package", () => {
    const fields = resolveFields([], {
      ecosystem: "npm",
      pkg: "event-stream",
      version: "3.3.6",
    });
    expect(evaluateCondition(rule, fields)).toBe(true);
  });

  it("does not fire for a safe package", () => {
    const fields = resolveFields([], {
      ecosystem: "npm",
      pkg: "lodash",
      version: "4.17.15",
    });
    expect(evaluateCondition(rule, fields)).toBe(false);
  });
});

describe("scenario: block suspiciously new packages (age + downloads)", () => {
  // Block if: published < 1 day ago AND total downloads < 100
  const rule: Condition = {
    all: [
      { field: "source.osv.days_since_published", operator: "lt", value: 1 },
      { field: "source.osv.download_count", operator: "lt", value: 100 },
    ],
  };

  it("fires when package is brand-new with almost no downloads", () => {
    expect(
      evaluateCondition(rule, {
        "source.osv.days_since_published": 0,
        "source.osv.download_count": 5,
      }),
    ).toBe(true);
  });

  it("does not fire when package is new but well-downloaded", () => {
    expect(
      evaluateCondition(rule, {
        "source.osv.days_since_published": 0,
        "source.osv.download_count": 50000,
      }),
    ).toBe(false);
  });

  it("does not fire when package is old (even with low downloads)", () => {
    expect(
      evaluateCondition(rule, {
        "source.osv.days_since_published": 30,
        "source.osv.download_count": 5,
      }),
    ).toBe(false);
  });
});

describe("scenario: severity threshold with multiple levels", () => {
  // Block if: critical > 0 OR high > 5
  const rule: Condition = {
    any: [
      { field: "source.osv.critical_count", operator: "gt", value: 0 },
      { field: "source.osv.high_count", operator: "gt", value: 5 },
    ],
  };

  it("fires on any critical CVE", () => {
    expect(
      evaluateCondition(rule, {
        "source.osv.critical_count": 1,
        "source.osv.high_count": 0,
      }),
    ).toBe(true);
  });

  it("fires when high CVE count exceeds threshold", () => {
    expect(
      evaluateCondition(rule, {
        "source.osv.critical_count": 0,
        "source.osv.high_count": 6,
      }),
    ).toBe(true);
  });

  it("fires on both", () => {
    expect(
      evaluateCondition(rule, {
        "source.osv.critical_count": 2,
        "source.osv.high_count": 10,
      }),
    ).toBe(true);
  });

  it("does not fire when both are within threshold", () => {
    expect(
      evaluateCondition(rule, {
        "source.osv.critical_count": 0,
        "source.osv.high_count": 4,
      }),
    ).toBe(false);
  });

  it("does not fire when counts are exactly at threshold (strict gt)", () => {
    expect(
      evaluateCondition(rule, {
        "source.osv.critical_count": 0,
        "source.osv.high_count": 5,
      }),
    ).toBe(false);
  });
});

describe("scenario: package name pattern rules", () => {
  // Warn on packages that look like typosquats of popular libs
  const rule: Condition = {
    any: [
      { field: "asset.package", operator: "starts_with", value: "reakt" },
      { field: "asset.package", operator: "starts_with", value: "lodahs" },
      { field: "asset.package", operator: "ends_with", value: "-stealr" },
    ],
  };

  it("fires for a typosquat prefix", () => {
    const fields = resolveFields([], {
      ecosystem: "npm",
      pkg: "reakt-dom",
      version: "1.0.0",
    });
    expect(evaluateCondition(rule, fields)).toBe(true);
  });

  it("fires for a suspicious suffix", () => {
    const fields = resolveFields([], {
      ecosystem: "npm",
      pkg: "lodash-stealr",
      version: "1.0.0",
    });
    expect(evaluateCondition(rule, fields)).toBe(true);
  });

  it("does not fire for a legitimate package", () => {
    const fields = resolveFields([], {
      ecosystem: "npm",
      pkg: "lodash",
      version: "4.17.15",
    });
    expect(evaluateCondition(rule, fields)).toBe(false);
  });
});

describe("scenario: complex — block if CVEs found AND not in approved allowlist", () => {
  const rule: Condition = {
    all: [
      { field: "source.osv.critical_count", operator: "gt", value: 0 },
      {
        not: {
          field: "asset.package",
          operator: "in",
          value: ["lodash", "express"], // approved despite known CVEs
        },
      },
    ],
  };

  it("fires for a vulnerable non-approved package", () => {
    expect(
      evaluateCondition(rule, {
        "source.osv.critical_count": 2,
        "asset.package": "some-random-pkg",
      }),
    ).toBe(true);
  });

  it("does not fire for an approved package even with CVEs", () => {
    expect(
      evaluateCondition(rule, {
        "source.osv.critical_count": 2,
        "asset.package": "lodash",
      }),
    ).toBe(false);
  });

  it("does not fire when there are no CVEs", () => {
    expect(
      evaluateCondition(rule, {
        "source.osv.critical_count": 0,
        "asset.package": "some-random-pkg",
      }),
    ).toBe(false);
  });
});
