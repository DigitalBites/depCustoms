export declare const VALID_TO_INFINITY_ISO = "9999-12-31T23:59:59.999Z";
export declare const VALID_TO_INFINITY_SQL_TIMESTAMPTZ = "'9999-12-31 23:59:59.999+00'";

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

export declare const ACTOR_RESOLUTION_MODES: readonly [
  "ids_only",
  "with_profile",
];
export type ActorResolutionMode = (typeof ACTOR_RESOLUTION_MODES)[number];

export declare const ACTOR_RESOLUTION_MODE: {
  readonly IDS_ONLY: "ids_only";
  readonly WITH_PROFILE: "with_profile";
};

export declare const CAPABILITY: {
  readonly MEMBERS_READ: "members.read";
  readonly TOKENS_READ_ALL: "tokens.read_all";
  readonly TOKENS_READ_OWN: "tokens.read_own";
  readonly TOKENS_CREATE: "tokens.create";
  readonly TOKENS_REVOKE_ANY: "tokens.revoke_any";
  readonly TOKENS_REVOKE_OWN: "tokens.revoke_own";
  readonly TOKENS_ROTATE_ANY: "tokens.rotate_any";
  readonly TOKENS_ROTATE_OWN: "tokens.rotate_own";
  readonly VIOLATIONS_READ_TENANT: "violations.read_tenant";
  readonly VIOLATIONS_READ_PROJECT: "violations.read_project";
  readonly VIOLATIONS_WRITE: "violations.write";
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

export declare const REQUEST_EVENT_SOURCES: readonly ["proxy", "policy_engine"];
export type RequestEventSource = (typeof REQUEST_EVENT_SOURCES)[number];

export declare const REQUEST_EVENT_SOURCE: {
  readonly PROXY: "proxy";
  readonly POLICY_ENGINE: "policy_engine";
};

export declare const REQUEST_EVENT_TYPES: readonly [
  "metadata",
  "artifact",
  "upstream_error",
  "proxy_request",
];
export type RequestEventType = (typeof REQUEST_EVENT_TYPES)[number];

export declare const REQUEST_EVENT_TYPE: {
  readonly METADATA: "metadata";
  readonly ARTIFACT: "artifact";
  readonly UPSTREAM_ERROR: "upstream_error";
  readonly PROXY_REQUEST: "proxy_request";
};

export declare const DECISIONS: readonly ["allow", "block"];
export type Decision = (typeof DECISIONS)[number];

export declare const DECISION: {
  readonly ALLOW: "allow";
  readonly BLOCK: "block";
};

export declare const DECISION_PATHS: readonly [
  "cache_hit",
  "check",
  "control_plane_unavailable",
  "bypass",
];
export type DecisionPath = (typeof DECISION_PATHS)[number];

export declare const DECISION_PATH: {
  readonly CACHE_HIT: "cache_hit";
  readonly CHECK: "check";
  readonly CONTROL_PLANE_UNAVAILABLE: "control_plane_unavailable";
  readonly BYPASS: "bypass";
};

export declare const SERVE_MODES: readonly [
  "SERVE_MODE_REDIRECT",
  "SERVE_MODE_PULL",
];
export type ServeMode = (typeof SERVE_MODES)[number];

export declare const SERVE_MODE: {
  readonly REDIRECT: "SERVE_MODE_REDIRECT";
  readonly PULL: "SERVE_MODE_PULL";
};

export declare const METADATA_CACHE_STATUSES: readonly [
  "hit",
  "miss",
  "stale",
  "refresh",
];
export type MetadataCacheStatus = (typeof METADATA_CACHE_STATUSES)[number];

export declare const METADATA_CACHE_STATUS: {
  readonly HIT: "hit";
  readonly MISS: "miss";
  readonly STALE: "stale";
  readonly REFRESH: "refresh";
};

export declare const PROXY_STATUS_EVENT_TYPES: readonly [
  "proxy_service_running",
  "proxy_service_stopped",
  "control_plane_unavailable",
  "control_plane_available",
  "token_exchange_attempt",
  "token_issued",
  "token_exchange_failed",
  "proxy_disabled",
  "proxy_enabled",
  "secret_rotated",
  "proxy_revoked",
];
export type ProxyStatusEventType = (typeof PROXY_STATUS_EVENT_TYPES)[number];

export declare const PROXY_STATUS_EVENT_TYPE: {
  readonly PROXY_SERVICE_RUNNING: "proxy_service_running";
  readonly PROXY_SERVICE_STOPPED: "proxy_service_stopped";
  readonly CONTROL_PLANE_UNAVAILABLE: "control_plane_unavailable";
  readonly CONTROL_PLANE_AVAILABLE: "control_plane_available";
  readonly TOKEN_EXCHANGE_ATTEMPT: "token_exchange_attempt";
  readonly TOKEN_ISSUED: "token_issued";
  readonly TOKEN_EXCHANGE_FAILED: "token_exchange_failed";
  readonly PROXY_DISABLED: "proxy_disabled";
  readonly PROXY_ENABLED: "proxy_enabled";
  readonly SECRET_ROTATED: "secret_rotated";
  readonly PROXY_REVOKED: "proxy_revoked";
};
