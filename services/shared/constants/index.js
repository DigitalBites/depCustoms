export const VALID_TO_INFINITY_ISO = "9999-12-31T23:59:59.999Z";
export const VALID_TO_INFINITY_SQL_TIMESTAMPTZ =
  "'9999-12-31 23:59:59.999+00'";

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

export const ACTOR_RESOLUTION_MODES = ["ids_only", "with_profile"];

export const ACTOR_RESOLUTION_MODE = {
  IDS_ONLY: "ids_only",
  WITH_PROFILE: "with_profile",
};

export const CAPABILITY = {
  MEMBERS_READ: "members.read",
  PLATFORM_PROXIES_SET_ALL_TENANTS: "platform.proxies.set_all_tenants",
  TENANT_NAME_WRITE: "tenant.name.write",
  TOKENS_READ_ALL: "tokens.read_all",
  TOKENS_READ_OWN: "tokens.read_own",
  TOKENS_CREATE: "tokens.create",
  TOKENS_REVOKE_ANY: "tokens.revoke_any",
  TOKENS_REVOKE_OWN: "tokens.revoke_own",
  TOKENS_ROTATE_ANY: "tokens.rotate_any",
  TOKENS_ROTATE_OWN: "tokens.rotate_own",
  VIOLATIONS_READ_TENANT: "violations.read_tenant",
  VIOLATIONS_READ_PROJECT: "violations.read_project",
  VIOLATIONS_WRITE: "violations.write",
};

export const TENANT_KINDS = ["platform", "customer"];

export const TENANT_KIND = {
  PLATFORM: "platform",
  CUSTOMER: "customer",
};

export const TENANT_PROXY_SCOPES = ["owner_only", "all_tenants"];

export const TENANT_PROXY_SCOPE = {
  OWNER_ONLY: "owner_only",
  ALL_TENANTS: "all_tenants",
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

export const REQUEST_EVENT_SOURCES = ["proxy", "policy_engine"];

export const REQUEST_EVENT_SOURCE = {
  PROXY: "proxy",
  POLICY_ENGINE: "policy_engine",
};

export const REQUEST_EVENT_TYPES = [
  "metadata",
  "artifact",
  "upstream_error",
  "proxy_request",
];

export const REQUEST_EVENT_TYPE = {
  METADATA: "metadata",
  ARTIFACT: "artifact",
  UPSTREAM_ERROR: "upstream_error",
  PROXY_REQUEST: "proxy_request",
};

export const DECISIONS = ["allow", "block"];

export const DECISION = {
  ALLOW: "allow",
  BLOCK: "block",
};

export const DECISION_PATHS = [
  "cache_hit",
  "check",
  "control_plane_unavailable",
  "bypass",
];

export const DECISION_PATH = {
  CACHE_HIT: "cache_hit",
  CHECK: "check",
  CONTROL_PLANE_UNAVAILABLE: "control_plane_unavailable",
  BYPASS: "bypass",
};

export const SERVE_MODES = ["SERVE_MODE_REDIRECT", "SERVE_MODE_PULL"];

export const SERVE_MODE = {
  REDIRECT: "SERVE_MODE_REDIRECT",
  PULL: "SERVE_MODE_PULL",
};

export const METADATA_CACHE_STATUSES = ["hit", "miss", "stale", "refresh"];

export const METADATA_CACHE_STATUS = {
  HIT: "hit",
  MISS: "miss",
  STALE: "stale",
  REFRESH: "refresh",
};

export const ECOSYSTEMS = ["npm", "pypi", "docker"];

export const ECOSYSTEM = {
  NPM: "npm",
  PYPI: "pypi",
  DOCKER: "docker",
};

export const VERSION_KINDS = ["version", "digest", "artifact"];

export const VERSION_KIND = {
  VERSION: "version",
  DIGEST: "digest",
  ARTIFACT: "artifact",
};

export const ARTIFACT_KINDS = [
  "package_release",
  "docker_index",
  "docker_manifest",
  "docker_blob",
];

export const ARTIFACT_KIND = {
  PACKAGE_RELEASE: "package_release",
  DOCKER_INDEX: "docker_index",
  DOCKER_MANIFEST: "docker_manifest",
  DOCKER_BLOB: "docker_blob",
};

export const DISPLAY_ROLES = ["primary", "child", "internal"];

export const DISPLAY_ROLE = {
  PRIMARY: "primary",
  CHILD: "child",
  INTERNAL: "internal",
};

export const PACKAGE_VERSION_REF_KINDS = [
  "tag",
  "dist_tag",
  "digest",
  "version",
  "filename",
  "alias",
];

export const PACKAGE_VERSION_REF_KIND = {
  TAG: "tag",
  DIST_TAG: "dist_tag",
  DIGEST: "digest",
  VERSION: "version",
  FILENAME: "filename",
  ALIAS: "alias",
};

export const PACKAGE_VERSION_REF_SOURCES = [
  "proxy",
  "registry_metadata",
  "sync",
];

export const PACKAGE_VERSION_REF_SOURCE = {
  PROXY: "proxy",
  REGISTRY_METADATA: "registry_metadata",
  SYNC: "sync",
};

export const PACKAGE_VERSION_METADATA_KINDS = [
  "descriptor",
  "platform",
  "integrity",
  "distribution_file",
  "provenance",
  "registry_metadata",
];

export const PACKAGE_VERSION_METADATA_KIND = {
  DESCRIPTOR: "descriptor",
  PLATFORM: "platform",
  INTEGRITY: "integrity",
  DISTRIBUTION_FILE: "distribution_file",
  PROVENANCE: "provenance",
  REGISTRY_METADATA: "registry_metadata",
};

export const PACKAGE_VERSION_RELATIONSHIP_TYPES = [
  "index_manifest",
  "manifest_config",
  "manifest_layer",
  "attestation_manifest",
  "contains",
  "resolves_to",
];

export const PACKAGE_VERSION_RELATIONSHIP_TYPE = {
  INDEX_MANIFEST: "index_manifest",
  MANIFEST_CONFIG: "manifest_config",
  MANIFEST_LAYER: "manifest_layer",
  ATTESTATION_MANIFEST: "attestation_manifest",
  CONTAINS: "contains",
  RESOLVES_TO: "resolves_to",
};

export const PROXY_STATUS_EVENT_TYPES = [
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

export const PROXY_STATUS_EVENT_TYPE = {
  PROXY_SERVICE_RUNNING: "proxy_service_running",
  PROXY_SERVICE_STOPPED: "proxy_service_stopped",
  CONTROL_PLANE_UNAVAILABLE: "control_plane_unavailable",
  CONTROL_PLANE_AVAILABLE: "control_plane_available",
  TOKEN_EXCHANGE_ATTEMPT: "token_exchange_attempt",
  TOKEN_ISSUED: "token_issued",
  TOKEN_EXCHANGE_FAILED: "token_exchange_failed",
  PROXY_DISABLED: "proxy_disabled",
  PROXY_ENABLED: "proxy_enabled",
  SECRET_ROTATED: "secret_rotated",
  PROXY_REVOKED: "proxy_revoked",
};
