/**
 * Policy expression engine — evaluates a JSONB condition tree against a
 * resolved field map. Pure function, no side effects, no DB I/O.
 *
 * Grammar:
 *   Leaf node: { field, operator, value }
 *   Group:     { all: [condition, ...] }   // AND
 *              { any: [condition, ...] }   // OR
 *              { not: condition }          // NOT
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LeafCondition {
  field: string;
  operator: string;
  value?: unknown;
}

export interface AllCondition {
  all: Condition[];
}

export interface AnyCondition {
  any: Condition[];
}

export interface NotCondition {
  not: Condition;
}

export type Condition =
  | LeafCondition
  | AllCondition
  | AnyCondition
  | NotCondition;

export interface TraceNode {
  node: "leaf" | "all" | "any" | "not";
  result: boolean;
  field?: string;
  operator?: string;
  value?: unknown;
  resolved?: unknown;
  children?: TraceNode[];
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isAll(c: Condition): c is AllCondition {
  return "all" in c && Array.isArray(c.all);
}

function isAny(c: Condition): c is AnyCondition {
  return "any" in c && Array.isArray(c.any);
}

function isNot(c: Condition): c is NotCondition {
  return "not" in c;
}

function isLeaf(c: Condition): c is LeafCondition {
  return "field" in c && "operator" in c;
}

// ---------------------------------------------------------------------------
// Leaf evaluation
// ---------------------------------------------------------------------------

function evaluateLeaf(
  fieldValue: unknown,
  operator: string,
  conditionValue: unknown,
): boolean {
  switch (operator) {
    case "exists":
      return fieldValue !== null && fieldValue !== undefined;
    case "not_exists":
      return fieldValue === null || fieldValue === undefined;
    case "is_true":
      return fieldValue === true;
    case "is_false":
      return fieldValue === false;
  }

  // All remaining operators require a non-null field value to match
  if (fieldValue === null || fieldValue === undefined) return false;

  switch (operator) {
    case "eq":
      // Deliberately use abstract equality so policy values can match across
      // string/number boundaries coming from request and storage layers.
      // eslint-disable-next-line eqeqeq
      return fieldValue == conditionValue;
    case "ne":
      // eslint-disable-next-line eqeqeq
      return fieldValue != conditionValue;
    case "gt":
      return (fieldValue as number) > (conditionValue as number);
    case "gte":
      return (fieldValue as number) >= (conditionValue as number);
    case "lt":
      return (fieldValue as number) < (conditionValue as number);
    case "lte":
      return (fieldValue as number) <= (conditionValue as number);
    case "in":
      return (
        Array.isArray(conditionValue) && conditionValue.includes(fieldValue)
      );
    case "not_in":
      return (
        Array.isArray(conditionValue) && !conditionValue.includes(fieldValue)
      );
    case "contains":
      return (
        typeof fieldValue === "string" &&
        fieldValue.includes(conditionValue as string)
      );
    case "not_contains":
      return (
        typeof fieldValue === "string" &&
        !fieldValue.includes(conditionValue as string)
      );
    case "starts_with":
      return (
        typeof fieldValue === "string" &&
        fieldValue.startsWith(conditionValue as string)
      );
    case "ends_with":
      return (
        typeof fieldValue === "string" &&
        fieldValue.endsWith(conditionValue as string)
      );
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Main evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate a condition tree against a resolved field map.
 * Returns true when the condition matches, false otherwise.
 */
export function evaluateCondition(
  condition: Condition,
  fields: Record<string, unknown>,
): boolean {
  return _evaluate(condition, fields);
}

/**
 * Evaluate with a trace for debugging / preview responses.
 * Returns both the boolean result and a trace tree.
 */
export function evaluateConditionWithTrace(
  condition: Condition,
  fields: Record<string, unknown>,
): { result: boolean; trace: TraceNode } {
  return _evaluateWithTrace(condition, fields);
}

function _evaluate(
  condition: Condition,
  fields: Record<string, unknown>,
): boolean {
  if (isAll(condition)) {
    return condition.all.every((c) => _evaluate(c, fields));
  }
  if (isAny(condition)) {
    return condition.any.some((c) => _evaluate(c, fields));
  }
  if (isNot(condition)) {
    return !_evaluate(condition.not, fields);
  }
  if (isLeaf(condition)) {
    const fieldValue = fields[condition.field] ?? null;
    return evaluateLeaf(fieldValue, condition.operator, condition.value);
  }
  return false;
}

function _evaluateWithTrace(
  condition: Condition,
  fields: Record<string, unknown>,
): { result: boolean; trace: TraceNode } {
  if (isAll(condition)) {
    const children = condition.all.map(
      (c) => _evaluateWithTrace(c, fields).trace,
    );
    const result = children.every((t) => t.result);
    return { result, trace: { node: "all", result, children } };
  }
  if (isAny(condition)) {
    const children = condition.any.map(
      (c) => _evaluateWithTrace(c, fields).trace,
    );
    const result = children.some((t) => t.result);
    return { result, trace: { node: "any", result, children } };
  }
  if (isNot(condition)) {
    const inner = _evaluateWithTrace(condition.not, fields);
    const result = !inner.result;
    return { result, trace: { node: "not", result, children: [inner.trace] } };
  }
  if (isLeaf(condition)) {
    const resolved = fields[condition.field] ?? null;
    const result = evaluateLeaf(resolved, condition.operator, condition.value);
    return {
      result,
      trace: {
        node: "leaf",
        result,
        field: condition.field,
        operator: condition.operator,
        value: condition.value,
        resolved,
      },
    };
  }
  return { result: false, trace: { node: "leaf", result: false } };
}

// ---------------------------------------------------------------------------
// Template rendering — "Package has {{source.osv.critical_count}} critical CVEs"
// ---------------------------------------------------------------------------
export function renderTemplate(
  template: string,
  fields: Record<string, unknown>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, ref) => {
    const val = fields[ref.trim()];
    if (val === null || val === undefined) return "?";
    if (typeof val === "object") {
      try {
        return JSON.stringify(val);
      } catch {
        return "[object]";
      }
    }
    if (typeof val === "string") return val;
    if (
      typeof val === "number" ||
      typeof val === "boolean" ||
      typeof val === "bigint"
    ) {
      return `${val}`;
    }
    return "[value]";
  });
}
