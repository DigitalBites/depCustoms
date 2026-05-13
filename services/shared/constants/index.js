export const VALID_TO_INFINITY_ISO = "9999-12-31T23:59:59.999Z";
export const VALID_TO_INFINITY_SQL_TIMESTAMPTZ =
  "'9999-12-31 23:59:59.999+00'::timestamptz";

export const POLICY_SCOPES = ["global", "project"];

export const POLICY_SCOPE = {
  GLOBAL: "global",
  PROJECT: "project",
};

export const POLICY_STATUSES = ["active", "draft", "archived"];
export const CREATABLE_POLICY_STATUSES = ["active", "draft"];

export const POLICY_STATUS = {
  ACTIVE: "active",
  DRAFT: "draft",
  ARCHIVED: "archived",
};

export const ENFORCEMENT_MODES = ["enforcing", "advisory", "disabled"];
export const RULE_ENFORCEMENT_MODES = ["enforcing", "advisory"];
export const ENFORCEMENT_MODE_OVERRIDES = ["advisory", "disabled"];

export const ENFORCEMENT_MODE = {
  ENFORCING: "enforcing",
  ADVISORY: "advisory",
  DISABLED: "disabled",
};

export const POLICY_BINDING_INHERITANCE_MODES = [
  "inherited",
  "override",
  "disabled",
];

export const RULE_TARGET_ENTITIES = [
  "artifact",
  "dependency",
  "finding",
  "repository",
];

export const RULE_TARGET_ENTITY = {
  ARTIFACT: "artifact",
  DEPENDENCY: "dependency",
  FINDING: "finding",
  REPOSITORY: "repository",
};

export const RULE_ACTION_TYPES = ["violation", "warning", "info"];

export const SEVERITIES = ["critical", "high", "medium", "low"];

export const SCORE_TIERS = ["LOW", "MEDIUM", "HIGH", "NONE"];

export const VIOLATION_STATUSES = ["open", "resolved", "suppressed"];
export const WRITABLE_VIOLATION_STATUSES = ["resolved", "suppressed"];
export const VIOLATION_OCCURRENCE_STATUSES = [
  "open",
  "resolved",
  "suppressed",
];

export const VIOLATION_STATUS = {
  OPEN: "open",
  RESOLVED: "resolved",
  SUPPRESSED: "suppressed",
};

export const VIOLATION_FINDING_RELATIONSHIP_TYPES = [
  "evidence",
  "primary",
  "contributing",
];

export const VIOLATION_FINDING_RELATIONSHIP_TYPE = {
  EVIDENCE: "evidence",
  PRIMARY: "primary",
  CONTRIBUTING: "contributing",
};

export const CONNECTOR_KEYS = ["osv", "contributor", "intelligence"];

export const CONNECTOR_KEY = {
  OSV: "osv",
  CONTRIBUTOR: "contributor",
  INTELLIGENCE: "intelligence",
};

export const EVENT_SOURCES = [
  "cache",
  "cache_degraded",
  "check",
  "control_plane_unavailable",
  "upstream_error",
  "proxy_check",
];

export const EVENT_TYPES = ["artifact", "upstream_error", "policy_engine"];

export const DECISIONS = ["allow", "block"];

export const SERVE_MODES = ["SERVE_MODE_REDIRECT", "SERVE_MODE_PULL"];
