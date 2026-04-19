import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  bigint,
  jsonb,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// tenants
// ---------------------------------------------------------------------------
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// tenant_entitlements
// Platform-controlled only — never exposed to tenant-facing API endpoints.
// null allowed_ecosystems = unrestricted (enterprise / all current + future).
// non-null = explicit allowlist; all other ecosystems blocked.
// serve_mode: how the proxy serves allowed artifacts (SERVE_MODE_REDIRECT | SERVE_MODE_PULL)
// cache_ttl_seconds: proxy cache TTL returned in CheckResponse
// ---------------------------------------------------------------------------
export const tenant_entitlements = pgTable(
  "tenant_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    allowed_ecosystems: text("allowed_ecosystems").array(),
    // Proxy serve mode for all projects under this tenant
    serve_mode: text("serve_mode").notNull().default("SERVE_MODE_REDIRECT"),
    // Proxy cache TTL (seconds) returned in CheckResponse
    cache_ttl_seconds: integer("cache_ttl_seconds").notNull().default(300),
    mcp_enabled: boolean("mcp_enabled").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("tenant_entitlements_tenant_id_idx").on(t.tenant_id)],
);

// ---------------------------------------------------------------------------
// memberships
// ---------------------------------------------------------------------------
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    user_id: uuid("user_id").notNull(),
    // role: owner | admin | member | guest
    // owner  — full tenant admin; auto-assigned at tenant creation
    // admin  — same capabilities as owner; added by owner/admin
    // member — project-scoped; can manage assigned projects, create projects, invite member/guest
    // guest  — project-scoped; can manage assigned projects only, cannot create or invite
    role: text("role").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("memberships_tenant_id_idx").on(t.tenant_id),
    index("memberships_user_id_idx").on(t.user_id),
  ],
);

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("projects_tenant_id_idx").on(t.tenant_id)],
);

// ---------------------------------------------------------------------------
// project_members
// Tracks which member/guest users belong to specific projects.
// owner/admin have implicit access to all projects — they are NOT listed here.
// ---------------------------------------------------------------------------
export const project_members = pgTable(
  "project_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    user_id: uuid("user_id").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("project_members_project_user_idx").on(t.project_id, t.user_id),
    index("project_members_tenant_id_idx").on(t.tenant_id),
    index("project_members_project_id_idx").on(t.project_id),
    index("project_members_user_id_idx").on(t.user_id),
  ],
);

// ---------------------------------------------------------------------------
// project_tokens
// ---------------------------------------------------------------------------
export const project_tokens = pgTable(
  "project_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    created_by_user_id: uuid("created_by_user_id").notNull(),
    token_hash: text("token_hash").notNull(),
    token_prefix: text("token_prefix").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
    expires_at: timestamp("expires_at", { withTimezone: true }),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    revoked_by_user_id: uuid("revoked_by_user_id"),
  },
  (t) => [
    index("project_tokens_project_id_idx").on(t.project_id),
    index("project_tokens_tenant_id_idx").on(t.tenant_id),
    index("project_tokens_project_creator_idx").on(
      t.project_id,
      t.created_by_user_id,
    ),
    uniqueIndex("project_tokens_token_hash_idx").on(t.token_hash),
  ],
);

// ---------------------------------------------------------------------------
// connector_fields
// Every field a connector can expose is registered here.
// The UI reads this table to build the rule-builder UI — no hardcoded field lists.
// Connectors self-register via getFieldCatalog() on every startup.
// deprecated=true: field was removed from connector code but may still be referenced by rules.
// ---------------------------------------------------------------------------
export const connector_fields = pgTable(
  "connector_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connector_key: text("connector_key").notNull(), // 'osv', 'github', 'trivy'
    field_key: text("field_key").notNull(), // 'critical_count', 'scan_age_hours'
    canonical_ref: text("canonical_ref").notNull(), // 'source.osv.critical_count'
    label: text("label").notNull(), // human-readable, shown in UI
    description: text("description"),
    data_type: text("data_type").notNull(), // 'integer' | 'float' | 'boolean' | 'string' | 'datetime'
    entity_type: text("entity_type").notNull(), // 'artifact' | 'dependency' | 'finding' | 'repository'
    operators: text("operators").array().notNull(), // valid operators for this data type
    enum_values: jsonb("enum_values"), // string[] | null — present on fixed-vocabulary fields
    deprecated: boolean("deprecated").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("connector_fields_connector_field_idx").on(
      t.connector_key,
      t.field_key,
    ),
    uniqueIndex("connector_fields_canonical_ref_idx").on(t.canonical_ref),
  ],
);

// ---------------------------------------------------------------------------
// connector_snapshots
// Normalized connector output. One row per (project_id, connector_key, entity_type, entity_id).
// The policy engine evaluates against this table rather than raw connector output.
// Critical: snapshots are ALWAYS written, even on connector failure.
// On failure: fields={}, meta.status=timeout|error|unavailable|background_pending.
// ---------------------------------------------------------------------------
export const connector_snapshots = pgTable(
  "connector_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    connector_key: text("connector_key").notNull(),
    entity_type: text("entity_type").notNull(), // 'artifact' | 'dependency' | 'finding' | 'repository'
    entity_id: text("entity_id").notNull(), // 'npm:lodash:4.17.21'
    fields: jsonb("fields").notNull(), // data fields; {} on failure
    meta: jsonb("meta").notNull(), // always populated, even on failure
    observed_at: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    raw_payload: jsonb("raw_payload"),
  },
  (t) => [
    uniqueIndex("connector_snapshots_key_idx").on(
      t.project_id,
      t.connector_key,
      t.entity_type,
      t.entity_id,
    ),
    index("connector_snapshots_project_entity_idx").on(
      t.project_id,
      t.entity_type,
      t.entity_id,
    ),
    index("connector_snapshots_observed_idx").on(
      t.project_id,
      t.connector_key,
      t.observed_at,
    ),
  ],
);

// ---------------------------------------------------------------------------
// policies (v2)
// Groups rules, declares scope (global or project), carries enforcement metadata.
// scope='global': project_id IS NULL — applies across all projects (via assignments)
// scope='project': project_id IS NOT NULL — applies only to that project
// ---------------------------------------------------------------------------
export const policies = pgTable(
  "policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // null = global policy; set = project-scoped policy
    project_id: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description"),
    // 'vulnerability-management' | 'supply-chain' | 'compliance'
    category: text("category"),
    // 'global' | 'project'
    scope: text("scope").notNull(),
    // 'active' | 'draft' | 'archived'
    status: text("status").notNull().default("active"),
    // 'enforcing' | 'advisory' | 'disabled'
    enforcement_mode: text("enforcement_mode").notNull().default("enforcing"),
    // lower priority = evaluated first
    priority: integer("priority").notNull().default(100),
    version: integer("version").notNull().default(1),
    // UUID of the Supabase auth user who created this policy (no FK — auth schema)
    created_by: uuid("created_by"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("policies_tenant_id_idx").on(t.tenant_id),
    index("policies_project_id_idx").on(t.project_id),
    index("policies_tenant_scope_status_idx").on(
      t.tenant_id,
      t.scope,
      t.status,
    ),
    check(
      "scope_project_consistency",
      sql`(${t.scope} = 'global' AND ${t.project_id} IS NULL) OR (${t.scope} = 'project' AND ${t.project_id} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// policy_assignments
// Links a global policy to a project with optional per-project overrides.
// ---------------------------------------------------------------------------
export const policy_assignments = pgTable(
  "policy_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policy_id: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    // 'inherited' | 'override' | 'disabled'
    inheritance_mode: text("inheritance_mode").notNull().default("inherited"),
    // Per-project overrides (may loosen but not tighten beyond global)
    severity_override: text("severity_override"),
    threshold_overrides: jsonb("threshold_overrides"), // { rule_id: { value: number } }
    enforcement_mode_override: text("enforcement_mode_override"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("policy_assignments_policy_project_idx").on(
      t.policy_id,
      t.project_id,
    ),
    index("policy_assignments_tenant_id_idx").on(t.tenant_id),
    index("policy_assignments_project_id_idx").on(t.project_id),
  ],
);

// ---------------------------------------------------------------------------
// rules
// A rule is a condition tree + action. Rules belong to a policy.
// condition: JSONB expression tree (leaf nodes + logical groups)
// action:    JSONB action object (type, severity, code, message_template, ...)
// ---------------------------------------------------------------------------
export const rules = pgTable(
  "rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policy_id: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // 'artifact' | 'dependency' | 'finding' | 'repository'
    target_entity: text("target_entity").notNull(),
    condition: jsonb("condition").notNull(), // expression tree
    action: jsonb("action").notNull(), // action object
    enabled: boolean("enabled").notNull().default(true),
    order_index: integer("order_index").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("rules_policy_id_idx").on(t.policy_id),
    index("rules_tenant_id_idx").on(t.tenant_id),
    index("rules_policy_order_idx").on(t.policy_id, t.order_index),
  ],
);

// ---------------------------------------------------------------------------
// events
// Request events only — one row per proxy package request.
//
// source:        'proxy' (written by WAL flush) | 'policy_engine' (written at Check RPC time)
// event_type:    'artifact' | 'metadata' | 'upstream_error' | 'proxy_request'
// decision_cache: true = decision served from proxy cache; null for policy_engine rows
// ---------------------------------------------------------------------------
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    project_id: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    proxy_id: uuid("proxy_id").notNull(),
    ecosystem: text("ecosystem").notNull(),
    package: text("package").notNull(),
    version: text("version").notNull(),
    decision: text("decision").notNull(),
    reason: text("reason"),
    // Who wrote this event: 'proxy' | 'policy_engine'
    source: text("source").notNull(),
    // What kind of request: 'artifact' | 'metadata' | 'upstream_error' | 'proxy_request'
    event_type: text("event_type").notNull(),
    // Was this decision served from the proxy cache? null for policy_engine rows.
    decision_cache: boolean("decision_cache"),
    trace_id: text("trace_id"),
    span_id: text("span_id"),
    request_id: text("request_id"),
    // serve_mode is null for BLOCK events; set for ALLOW events.
    serve_mode: text("serve_mode"),
    // bytes_transferred is null for policy_engine events (control plane records before
    // proxy serves). For WAL-flushed events: 0 for redirect, actual bytes for pull.
    bytes_transferred: bigint("bytes_transferred", { mode: "number" }),
    // Token attribution: null if the token has since been deleted.
    project_token_id: uuid("project_token_id").references(
      () => project_tokens.id,
      { onDelete: "set null" },
    ),
    // IP of the npm/pip client making the request (may be masked if PROXY_REDACT_CLIENT_IP=true).
    client_ip: text("client_ip"),
    // Network IP of the proxy instance (from PROXY_IP env var).
    proxy_ip: text("proxy_ip"),
    // Total proxy-side request latency in milliseconds (from request receipt to response sent).
    // Null for policy_engine events and events written by older proxy versions.
    duration_ms: integer("duration_ms"),
    // How the decision was reached: 'cache_hit' | 'check' | 'control_plane_unavailable'.
    // Null for policy_engine events and events written by older proxy versions.
    decision_path: text("decision_path"),
    requested_at: timestamp("requested_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("events_tenant_id_idx").on(t.tenant_id),
    index("events_project_id_idx").on(t.project_id),
    index("events_requested_at_idx").on(t.requested_at),
    index("events_ecosystem_idx").on(t.ecosystem),
    index("events_decision_idx").on(t.decision),
    index("events_project_token_id_idx").on(t.project_token_id),
  ],
);

// ---------------------------------------------------------------------------
// violations
// Written every time a rule with action.type='violation' matches during a
// real Check request — regardless of enforcement_mode. Advisory violations
// are recorded just like enforcing ones; the difference is only whether they
// caused a block.
// ---------------------------------------------------------------------------
export const violations = pgTable(
  "violations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // nullable: ON DELETE SET NULL — rule may be deleted after violation recorded
    rule_id: uuid("rule_id").references(() => rules.id, {
      onDelete: "set null",
    }),
    // nullable: ON DELETE SET NULL — policy may be archived/deleted
    policy_id: uuid("policy_id").references(() => policies.id, {
      onDelete: "set null",
    }),
    // nullable: ON DELETE SET NULL — token may be revoked/deleted
    project_token_id: uuid("project_token_id").references(
      () => project_tokens.id,
      { onDelete: "set null" },
    ),
    // Snapshots at evaluation time — remain meaningful if rule/policy is later
    // renamed or deleted.
    rule_name: text("rule_name").notNull().default(""),
    policy_name: text("policy_name").notNull().default(""),
    recommended_remediation: text("recommended_remediation"),
    entity_id: text("entity_id").notNull(), // 'npm:lodash:4.17.15'
    entity_type: text("entity_type").notNull(),
    severity: text("severity").notNull(), // from action.severity at evaluation time
    code: text("code").notNull(), // from action.code
    message: text("message").notNull(), // rendered message_template
    // 'enforcing' | 'advisory' at evaluation time
    enforcement_mode: text("enforcement_mode").notNull(),
    blocked: boolean("blocked").notNull(),
    // 'open' | 'resolved' | 'suppressed'
    status: text("status").notNull().default("open"),
    status_note: text("status_note"),
    // snapshot of resolved fields at decision time (audit trail)
    field_values_at_evaluation: jsonb("field_values_at_evaluation").notNull(),
    event_id: uuid("event_id").references(() => events.id, {
      onDelete: "set null",
    }),
    // FK to policy_evaluations — plain UUID (circular ref, no FK constraint)
    evaluation_id: uuid("evaluation_id"),
    evaluated_at: timestamp("evaluated_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("violations_project_status_idx").on(
      t.project_id,
      t.status,
      t.evaluated_at,
    ),
    index("violations_entity_idx").on(
      t.project_id,
      t.entity_id,
      t.evaluated_at,
    ),
    index("violations_rule_idx").on(t.rule_id, t.evaluated_at),
    index("violations_evaluation_id_idx").on(t.evaluation_id),
    index("violations_event_id_idx").on(t.event_id),
    index("violations_tenant_id_idx").on(t.tenant_id),
    index("violations_policy_id_idx").on(t.policy_id, t.evaluated_at),
    index("violations_token_id_idx").on(t.project_token_id),
  ],
);

// ---------------------------------------------------------------------------
// policy_evaluations
// One row per Check request that goes through the engine.
// Links to the event record for full trace correlation.
// ---------------------------------------------------------------------------
export const policy_evaluations = pgTable(
  "policy_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    entity_id: text("entity_id").notNull(),
    entity_type: text("entity_type").notNull(),
    decision: text("decision").notNull(), // 'allow' | 'block'
    policies_evaluated: integer("policies_evaluated").notNull(),
    rules_evaluated: integer("rules_evaluated").notNull(),
    rules_matched: integer("rules_matched").notNull(),
    // { "osv": { "status": "ok", "response_time_ms": 142 } }
    connector_snapshot_meta: jsonb("connector_snapshot_meta").notNull(),
    duration_ms: integer("duration_ms"),
    event_id: uuid("event_id").references(() => events.id, {
      onDelete: "set null",
    }),
    evaluated_at: timestamp("evaluated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("policy_evaluations_project_idx").on(t.project_id, t.evaluated_at),
    index("policy_evaluations_entity_idx").on(
      t.project_id,
      t.entity_id,
      t.evaluated_at,
    ),
    index("policy_evaluations_event_id_idx").on(t.event_id),
    index("policy_evaluations_tenant_id_idx").on(t.tenant_id),
  ],
);

// ---------------------------------------------------------------------------
// proxy_status_events
// Proxy lifecycle events (startup, shutdown, CP connectivity changes).
// Kept separate from events: different query patterns, different indexes,
// and most events columns would be null for every status row.
// ---------------------------------------------------------------------------
export const proxy_status_events = pgTable(
  "proxy_status_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // matches proxies.proxy_id (UUID string from PROXY_ID env var)
    proxy_id: uuid("proxy_id").notNull(),
    // IP of the proxy instance that wrote this event
    proxy_ip: text("proxy_ip"),
    // proxy_service_running | proxy_service_stopped |
    // control_plane_unavailable | control_plane_available
    event_type: text("event_type").notNull(),
    actor_user_id: uuid("actor_user_id"),
    detail: text("detail"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("proxy_status_events_tenant_id_idx").on(t.tenant_id),
    index("proxy_status_events_proxy_id_idx").on(t.proxy_id),
  ],
);

// ---------------------------------------------------------------------------
// proxy_metadata_cache_stats
// Aggregate metadata-cache telemetry windows reported by proxies.
// These are lightweight operational stats, not per-request events.
// ---------------------------------------------------------------------------
export const proxy_metadata_cache_stats = pgTable(
  "proxy_metadata_cache_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    proxy_id: uuid("proxy_id").notNull(),
    ecosystem: text("ecosystem").notNull(),
    hits: bigint("hits", { mode: "number" }).notNull().default(0),
    misses: bigint("misses", { mode: "number" }).notNull().default(0),
    stale_hits: bigint("stale_hits", { mode: "number" }).notNull().default(0),
    refreshes: bigint("refreshes", { mode: "number" }).notNull().default(0),
    parse_failures: bigint("parse_failures", { mode: "number" })
      .notNull()
      .default(0),
    store_failures: bigint("store_failures", { mode: "number" })
      .notNull()
      .default(0),
    window_started_at: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    window_ended_at: timestamp("window_ended_at", {
      withTimezone: true,
    }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("pmcs_tenant_id_idx").on(t.tenant_id),
    index("pmcs_proxy_id_idx").on(t.proxy_id),
    index("pmcs_tenant_window_idx").on(t.tenant_id, t.window_ended_at),
  ],
);

// ---------------------------------------------------------------------------
// mcp_audit_events
// Audit trail for MCP lifecycle and tool invocations.
// ---------------------------------------------------------------------------
export const mcp_audit_events = pgTable(
  "mcp_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    project_id: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    user_id: uuid("user_id").notNull(),
    role: text("role").notNull(),
    client_name: text("client_name"),
    session_id: text("session_id"),
    method_name: text("method_name").notNull(),
    target: jsonb("target"),
    outcome: text("outcome").notNull(),
    trace_id: text("trace_id"),
    request_id: text("request_id"),
    detail: text("detail"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mcp_audit_events_tenant_id_idx").on(t.tenant_id),
    index("mcp_audit_events_project_id_idx").on(t.project_id),
    index("mcp_audit_events_user_id_idx").on(t.user_id),
    index("mcp_audit_events_method_name_idx").on(t.method_name),
    index("mcp_audit_events_created_at_idx").on(t.created_at),
  ],
);

// ---------------------------------------------------------------------------
// proxies
// Each proxy instance is registered by a tenant owner and bound to exactly
// one tenant. The proxy authenticates every ConnectRPC call using its
// per-proxy secret (stored as SHA-256 hash). proxy_id is the UUID the
// operator sets in the PROXY_ID env var at deploy time.
// ---------------------------------------------------------------------------
export const proxies = pgTable(
  "proxies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    proxy_id: uuid("proxy_id").notNull(), // UUID from PROXY_ID env var
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    secret_hash: text("secret_hash").notNull(), // SHA-256 of PROXY_CONTROL_PLANE_SECRET
    secret_prev_hash: text("secret_prev_hash"),
    secret_prev_expires_at: timestamp("secret_prev_expires_at", {
      withTimezone: true,
    }),
    secret_prefix: text("secret_prefix").notNull(), // first 8 chars for display
    disabled_at: timestamp("disabled_at", { withTimezone: true }),
    secret_rotated_at: timestamp("secret_rotated_at", { withTimezone: true }),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("proxies_tenant_id_idx").on(t.tenant_id),
    uniqueIndex("proxies_proxy_id_idx").on(t.proxy_id),
  ],
);

// ---------------------------------------------------------------------------
// packages
// Global package catalog keyed on package identity only: (ecosystem, package).
// Version-specific state lives in package_versions.
// No tenant_id: packages are a global resource; enrichment data written here
// once benefits all tenants that use the package.
// ---------------------------------------------------------------------------
export const packages = pgTable(
  "packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecosystem: text("ecosystem").notNull(),
    package: text("package").notNull(),
    latest_package_version_id: uuid("latest_package_version_id"),
    contributor_fingerprint: text("contributor_fingerprint"),
    contributor_history_complete: boolean("contributor_history_complete")
      .notNull()
      .default(false),
    contributor_oldest_included_published_at: timestamp(
      "contributor_oldest_included_published_at",
      { withTimezone: true },
    ),
    last_metadata_seen_at: timestamp("last_metadata_seen_at", {
      withTimezone: true,
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("packages_eco_pkg_idx").on(t.ecosystem, t.package),
    index("packages_ecosystem_idx").on(t.ecosystem),
    index("packages_latest_package_version_id_idx").on(
      t.latest_package_version_id,
    ),
  ],
);

// ---------------------------------------------------------------------------
// package_versions
// Global version catalog keyed on (package_id, version). Populated by metadata
// and usage traffic for downstream freshness, cache, and package views.
// ---------------------------------------------------------------------------
export const package_versions = pgTable(
  "package_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    package_id: uuid("package_id")
      .notNull()
      .references(() => packages.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    published_at: timestamp("published_at", { withTimezone: true }),
    last_metadata_seen_at: timestamp("last_metadata_seen_at", {
      withTimezone: true,
    }),
    contributor_slice_fingerprint: text("contributor_slice_fingerprint"),
    contributor_slice_observed_at: timestamp("contributor_slice_observed_at", {
      withTimezone: true,
    }),
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("package_versions_pkg_ver_idx").on(t.package_id, t.version),
    index("package_versions_package_id_idx").on(t.package_id),
    index("package_versions_version_idx").on(t.version),
  ],
);

// ---------------------------------------------------------------------------
// project_package_usage
// Per-project usage counters linked to the global package_versions catalog.
// One row per (project_id, package_version_id) pair — upserted on every WAL flush
// that contains artifact or upstream_error events (source='proxy' only).
//
// created_at: set once on first insert (first_seen semantics).
// updated_at: bumped on every conflict update (last_seen semantics).
//
// Reset: DELETE WHERE tenant_id=? AND project_id=? (packages catalog untouched).
// Rebuild: DELETE + INSERT...SELECT from events for the project.
// ---------------------------------------------------------------------------
export const project_package_usage = pgTable(
  "project_package_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    package_version_id: uuid("package_version_id")
      .notNull()
      .references(() => package_versions.id, { onDelete: "cascade" }),
    request_count: integer("request_count").notNull().default(0),
    allow_count: integer("allow_count").notNull().default(0),
    block_count: integer("block_count").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ppu_project_package_version_idx").on(
      t.project_id,
      t.package_version_id,
    ),
    index("ppu_tenant_id_idx").on(t.tenant_id),
    // Supports future cross-project "who uses package X?" query
    index("ppu_package_version_id_idx").on(t.package_version_id),
  ],
);

// ---------------------------------------------------------------------------
// contributor_release_facts
// Durable contributor source-of-truth table. One row per package_version_id.
// Hybrid model: normalized queryable facts + preserved compact source payload.
// ---------------------------------------------------------------------------
export const contributor_release_facts = pgTable(
  "contributor_release_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    package_version_id: uuid("package_version_id").notNull(),
    published_at: timestamp("published_at", { withTimezone: true }),
    source_kind: text("source_kind"),
    source_payload_version: text("source_payload_version"),
    source_payload: jsonb("source_payload"),
    source_observed_at: timestamp("source_observed_at", { withTimezone: true }),
    publish_actor: text("publish_actor"),
    publish_actor_kind: text("publish_actor_kind"),
    publisher_username: text("publisher_username"),
    publisher_display_name: text("publisher_display_name"),
    publisher_email: text("publisher_email"),
    publisher_id: text("publisher_id"),
    publisher_source: text("publisher_source"),
    has_trusted_publisher: boolean("has_trusted_publisher"),
    trusted_publisher_provider: text("trusted_publisher_provider"),
    trusted_publisher_oidc_config_id: text("trusted_publisher_oidc_config_id"),
    maintainer_count: integer("maintainer_count"),
    maintainers: text("maintainers").array(),
    maintainer_identities: jsonb("maintainer_identities"),
    maintainer_source: text("maintainer_source"),
    has_install_scripts: boolean("has_install_scripts"),
    has_provenance: boolean("has_provenance"),
    publisher_seen_before_package: boolean("publisher_seen_before_package"),
    publisher_seen_count_before: integer("publisher_seen_count_before"),
    publisher_matches_prior_version: boolean("publisher_matches_prior_version"),
    prior_package_version_id: uuid("prior_package_version_id"),
    prior_version_publish_actor: text("prior_version_publish_actor"),
    maintainer_set_changed: boolean("maintainer_set_changed"),
    maintainers_added: text("maintainers_added").array(),
    maintainers_removed: text("maintainers_removed").array(),
    new_maintainer_count: integer("new_maintainer_count"),
    removed_maintainer_count: integer("removed_maintainer_count"),
    release_velocity_7d_at_publish: integer("release_velocity_7d_at_publish"),
    release_velocity_30d_at_publish: integer("release_velocity_30d_at_publish"),
    first_published_at_for_package: timestamp(
      "first_published_at_for_package",
      {
        withTimezone: true,
      },
    ),
    package_release_index: integer("package_release_index"),
    publisher_identity_confidence: numeric("publisher_identity_confidence", {
      precision: 5,
      scale: 2,
    }),
    history_complete: boolean("history_complete"),
    observed_at: timestamp("observed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.package_version_id],
      foreignColumns: [package_versions.id],
      name: "crf_pkg_ver_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.prior_package_version_id],
      foreignColumns: [package_versions.id],
      name: "crf_prior_pkg_ver_fk",
    }).onDelete("set null"),
    uniqueIndex("crf_package_version_id_idx").on(t.package_version_id),
    index("crf_prior_package_version_id_idx").on(t.prior_package_version_id),
  ],
);

// ---------------------------------------------------------------------------
// violation_suppressions
// Forward-looking suppression table. When a matching entry exists, the gateway
// writes the violation with status='suppressed' instead of 'open'.
//
// project_id nullable:
//   null = tenant-wide (suppresses across all projects for this tenant)
//   set  = project-scoped (suppresses only for that project)
//
// Indexed on (project_id, entity_id, rule_id) for gateway hot-path lookup.
// ---------------------------------------------------------------------------
export const violation_suppressions = pgTable(
  "violation_suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // null = tenant-wide suppression; set = project-scoped suppression
    project_id: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    // 'npm:lodash:4.17.15' — entity being suppressed
    entity_id: text("entity_id").notNull(),
    // null = suppress for all rules matching this entity
    rule_id: uuid("rule_id").references(() => rules.id, {
      onDelete: "set null",
    }),
    // Supabase auth user ID who created this suppression
    suppressed_by: uuid("suppressed_by"),
    suppressed_at: timestamp("suppressed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // null = permanent suppression
    expires_at: timestamp("expires_at", { withTimezone: true }),
    reason: text("reason"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("vs_project_entity_rule_idx").on(
      t.project_id,
      t.entity_id,
      t.rule_id,
    ),
    index("vs_tenant_entity_idx").on(t.tenant_id, t.entity_id),
    index("vs_tenant_id_idx").on(t.tenant_id),
  ],
);

// ---------------------------------------------------------------------------
// project_findings
// Disposition layer between raw connector data and the policy engine.
// One row per (project_id, connector_key, entity_id, finding_id).
// Populated by the gateway on every connector snapshot write (vuln_count > 0).
// Never deleted — withdrawn advisories stay for audit.
// ---------------------------------------------------------------------------
export const project_findings = pgTable(
  "project_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    connector_key: text("connector_key").notNull(), // 'osv', 'github', 'trivy'
    entity_id: text("entity_id").notNull(), // 'npm:lodash:4.17.15'
    finding_id: text("finding_id").notNull(), // connector's advisory ID (OSV ID, GHSA, etc.)
    severity: text("severity").notNull(), // CRITICAL|HIGH|MEDIUM|LOW|NONE
    title: text("title"), // short human-readable summary
    // Disposition
    // 'open' | 'suppressed' | 'resolved'
    status: text("status").notNull().default("open"),
    status_note: text("status_note"),
    // Supabase auth user ID
    status_updated_by: uuid("status_updated_by"),
    // Watermark — used by sync re-open logic:
    //   if project_package_usage.updated_at > status_updated_at => re-open
    status_updated_at: timestamp("status_updated_at", { withTimezone: true }),
    first_seen_at: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("pf_project_connector_entity_finding_idx").on(
      t.project_id,
      t.connector_key,
      t.entity_id,
      t.finding_id,
    ),
    index("pf_project_status_severity_idx").on(
      t.project_id,
      t.status,
      t.severity,
    ),
    index("pf_project_entity_connector_idx").on(
      t.project_id,
      t.entity_id,
      t.connector_key,
    ),
    index("pf_tenant_id_idx").on(t.tenant_id),
  ],
);

// ---------------------------------------------------------------------------
// project_connector_syncs
// Tracks the last sync run per (project, connector). Used by the security hub
// to show "last synced: X ago". Enforces cooldown between sync requests.
// ---------------------------------------------------------------------------
export const project_connector_syncs = pgTable(
  "project_connector_syncs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    connector_key: text("connector_key").notNull(),
    last_synced_at: timestamp("last_synced_at", {
      withTimezone: true,
    }).notNull(),
    synced_count: integer("synced_count"),
    new_findings: integer("new_findings"),
    reopened_count: integer("reopened_count"),
    duration_ms: integer("duration_ms"),
  },
  (t) => [
    uniqueIndex("pcs_project_connector_idx").on(t.project_id, t.connector_key),
  ],
);

// ---------------------------------------------------------------------------
// alert_configs
// Per-project or tenant-wide alert configuration. Designed for future use —
// only the schema is defined here; alerting logic is deferred to v3.
// ---------------------------------------------------------------------------
export const alert_configs = pgTable(
  "alert_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // null = tenant-wide config
    project_id: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    // null = all connectors
    connector_key: text("connector_key"),
    // CRITICAL|HIGH|MEDIUM|LOW
    min_severity: text("min_severity").notNull().default("HIGH"),
    // 'webhook' | 'slack' | 'email'
    channel: text("channel").notNull(),
    // URL, channel name, or email address
    destination: text("destination").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ac_tenant_id_idx").on(t.tenant_id),
    index("ac_project_id_idx").on(t.project_id),
  ],
);

// ---------------------------------------------------------------------------
// connector_cache
// Aggregate lookup cache for package intelligence connectors (OSV, etc.).
// One row per (connector_id, ecosystem, package, version).
//
// ttl_seconds: per-row TTL written at insert time. Staleness check uses this
// value when present, falling back to connector.config.cacheTtlSeconds when
// null. Allows connectors to apply age-based TTL (e.g. contributor connector
// caches fresh versions for 1 hour but stable versions for 72 hours) without
// a global config change. null = use the connector's global TTL.
//
// Promoted aggregate columns (max_severity, vuln_count, fix_available,
// best_fix_version, score_tier) are kept as real columns for fast SQL aggregate
// queries (COUNT/GROUP BY/ORDER BY) without GIN index scans.
//
// data: full connector payload as JSONB — findings array + connector-specific
// signals. Shape: { score_model_version, findings: [{ id, severity, title,
// published_at, attributes }] }. Connector-specific detail lives in
// finding.attributes. This blob is the portable unit for future Redis migration.
// ---------------------------------------------------------------------------
export const connector_cache = pgTable(
  "connector_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connector_id: text("connector_id").notNull(),
    ecosystem: text("ecosystem").notNull(),
    package: text("package").notNull(),
    version: text("version").notNull(),
    max_severity: text("max_severity").notNull(), // CRITICAL|HIGH|MEDIUM|LOW|NONE
    score_tier: text("score_tier"), // universal risk tier for non-OSV connectors
    vuln_count: integer("vuln_count").notNull().default(0),
    fix_available: boolean("fix_available").notNull().default(false),
    best_fix_version: text("best_fix_version"), // null = no known fix
    data: jsonb("data"), // full findings + connector signals
    ttl_seconds: integer("ttl_seconds"), // per-row TTL; null = use connector config
    queried_at: timestamp("queried_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("connector_cache_key_idx").on(
      t.connector_id,
      t.ecosystem,
      t.package,
      t.version,
    ),
    index("connector_cache_queried_idx").on(t.connector_id, t.queried_at),
  ],
);
