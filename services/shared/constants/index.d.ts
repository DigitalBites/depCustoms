export declare const VALID_TO_INFINITY_ISO = "9999-12-31T23:59:59.999Z";
export declare const VALID_TO_INFINITY_SQL_TIMESTAMPTZ = "'9999-12-31 23:59:59.999+00'::timestamptz";

export declare const POLICY_SCOPES: readonly ["global", "project"];
export type PolicyScope = (typeof POLICY_SCOPES)[number];

export declare const POLICY_SCOPE: {
  readonly GLOBAL: "global";
  readonly PROJECT: "project";
};

export declare const POLICY_STATUSES: readonly [
  "active",
  "draft",
  "archived",
];
export declare const CREATABLE_POLICY_STATUSES: readonly ["active", "draft"];
export type PolicyStatus = (typeof POLICY_STATUSES)[number];
export type CreatablePolicyStatus = (typeof CREATABLE_POLICY_STATUSES)[number];

export declare const POLICY_STATUS: {
  readonly ACTIVE: "active";
  readonly DRAFT: "draft";
  readonly ARCHIVED: "archived";
};

export declare const ENFORCEMENT_MODES: readonly [
  "enforcing",
  "advisory",
  "disabled",
];
export declare const RULE_ENFORCEMENT_MODES: readonly [
  "enforcing",
  "advisory",
];
export declare const ENFORCEMENT_MODE_OVERRIDES: readonly [
  "advisory",
  "disabled",
];
export type EnforcementMode = (typeof ENFORCEMENT_MODES)[number];
export type RuleEnforcementMode = (typeof RULE_ENFORCEMENT_MODES)[number];
export type EnforcementModeOverride =
  (typeof ENFORCEMENT_MODE_OVERRIDES)[number];

export declare const ENFORCEMENT_MODE: {
  readonly ENFORCING: "enforcing";
  readonly ADVISORY: "advisory";
  readonly DISABLED: "disabled";
};

export declare const POLICY_BINDING_INHERITANCE_MODES: readonly [
  "inherited",
  "override",
  "disabled",
];
export type PolicyBindingInheritanceMode =
  (typeof POLICY_BINDING_INHERITANCE_MODES)[number];

export declare const RULE_TARGET_ENTITIES: readonly [
  "artifact",
  "dependency",
  "finding",
  "repository",
];
export type RuleTargetEntity = (typeof RULE_TARGET_ENTITIES)[number];

export declare const RULE_TARGET_ENTITY: {
  readonly ARTIFACT: "artifact";
  readonly DEPENDENCY: "dependency";
  readonly FINDING: "finding";
  readonly REPOSITORY: "repository";
};

export declare const RULE_ACTION_TYPES: readonly [
  "violation",
  "warning",
  "info",
];
export type RuleActionType = (typeof RULE_ACTION_TYPES)[number];

export declare const SEVERITIES: readonly [
  "critical",
  "high",
  "medium",
  "low",
];
export type Severity = (typeof SEVERITIES)[number];

export declare const SCORE_TIERS: readonly ["LOW", "MEDIUM", "HIGH", "NONE"];
export type ScoreTier = (typeof SCORE_TIERS)[number];

export declare const VIOLATION_STATUSES: readonly [
  "open",
  "resolved",
  "suppressed",
];
export declare const WRITABLE_VIOLATION_STATUSES: readonly [
  "resolved",
  "suppressed",
];
export declare const VIOLATION_OCCURRENCE_STATUSES: readonly [
  "open",
  "resolved",
  "suppressed",
];
export type ViolationStatus = (typeof VIOLATION_STATUSES)[number];
export type WritableViolationStatus =
  (typeof WRITABLE_VIOLATION_STATUSES)[number];
export type ViolationOccurrenceStatus =
  (typeof VIOLATION_OCCURRENCE_STATUSES)[number];

export declare const VIOLATION_STATUS: {
  readonly OPEN: "open";
  readonly RESOLVED: "resolved";
  readonly SUPPRESSED: "suppressed";
};

export declare const VIOLATION_FINDING_RELATIONSHIP_TYPES: readonly [
  "evidence",
  "primary",
  "contributing",
];
export type ViolationFindingRelationshipType =
  (typeof VIOLATION_FINDING_RELATIONSHIP_TYPES)[number];

export declare const VIOLATION_FINDING_RELATIONSHIP_TYPE: {
  readonly EVIDENCE: "evidence";
  readonly PRIMARY: "primary";
  readonly CONTRIBUTING: "contributing";
};

export declare const CONNECTOR_KEYS: readonly [
  "osv",
  "contributor",
  "intelligence",
];
export type ConnectorKey = (typeof CONNECTOR_KEYS)[number];

export declare const CONNECTOR_KEY: {
  readonly OSV: "osv";
  readonly CONTRIBUTOR: "contributor";
  readonly INTELLIGENCE: "intelligence";
};

export declare const EVENT_SOURCES: readonly [
  "cache",
  "cache_degraded",
  "check",
  "control_plane_unavailable",
  "upstream_error",
  "proxy_check",
];
export type EventSource = (typeof EVENT_SOURCES)[number];

export declare const EVENT_TYPES: readonly [
  "artifact",
  "upstream_error",
  "policy_engine",
];
export type EventType = (typeof EVENT_TYPES)[number];

export declare const DECISIONS: readonly ["allow", "block"];
export type Decision = (typeof DECISIONS)[number];

export declare const SERVE_MODES: readonly [
  "SERVE_MODE_REDIRECT",
  "SERVE_MODE_PULL",
];
export type ServeMode = (typeof SERVE_MODES)[number];
