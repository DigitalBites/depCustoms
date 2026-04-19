export type ScopeFilter = "all" | "global" | "project";

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | LeafCondition;

export interface LeafCondition {
  field: string;
  operator: string;
  value?: unknown;
}

export interface CatalogField {
  canonical_ref: string;
  label: string;
  data_type: "integer" | "float" | "boolean" | "string" | "datetime";
  operators: string[];
  description?: string;
  deprecated?: boolean;
  enum_values?: string[];
  group_label: string;
}

export interface RuleAction {
  type: "violation" | "warning" | "info";
  severity?: "critical" | "high" | "medium" | "low";
  code?: string;
  message_template?: string;
  recommended_remediation?: string;
  enforcement_mode?: "enforcing" | "advisory";
}

export interface Rule {
  id: string;
  policy_id: string;
  tenant_id: string;
  name: string;
  description?: string | null;
  target_entity: string;
  condition: Condition;
  action: RuleAction;
  enabled: boolean;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface Policy {
  id: string;
  tenant_id: string;
  project_id?: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  scope: "global" | "project";
  status: "active" | "draft" | "archived";
  enforcement_mode: "enforcing" | "advisory" | "disabled";
  priority: number;
  version: number;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  rules?: Rule[];
}

export interface PolicyProjectSummary {
  id: string;
  name: string;
}

export interface PolicyDetailResponse {
  policy: Policy & { rules: Rule[] };
}

export interface PolicyRuleViolationCountsResponse {
  counts: Record<string, number>;
}

export interface CreatedPolicyResponse {
  policy: { id: string };
}

export interface TenantEntitlements {
  allowed_ecosystems: string[] | null;
}

export interface Violation {
  id: string;
  tenant_id: string;
  project_id: string;
  rule_id?: string | null;
  policy_id?: string | null;
  entity_id: string;
  entity_type: string;
  severity: string;
  code: string;
  message: string;
  enforcement_mode: string;
  blocked: boolean;
  status: "open" | "resolved" | "suppressed";
  status_note?: string | null;
  field_values_at_evaluation: Record<string, unknown>;
  event_id?: string | null;
  evaluation_id?: string | null;
  evaluated_at: string;
  created_at: string;
}

export const OPERATOR_LABELS: Record<string, string> = {
  eq: "equals",
  ne: "not equals",
  gt: "greater than",
  gte: "greater than or equal",
  lt: "less than",
  lte: "less than or equal",
  in: "is one of",
  not_in: "is not one of",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  ends_with: "ends with",
  is_true: "is true",
  is_false: "is false",
  exists: "exists",
  not_exists: "does not exist",
};

export const NO_VALUE_OPERATORS = new Set([
  "is_true",
  "is_false",
  "exists",
  "not_exists",
]);

export const ARRAY_VALUE_OPERATORS = new Set(["in", "not_in"]);
