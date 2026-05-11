import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  index,
  uniqueIndex,
  sql,
} from "./shared.js";
import { tenants, projects, project_tokens } from "./tenancy.js";
import { policies, rules } from "./policies.js";
import { packages, package_versions } from "./packages.js";

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
    package_id: uuid("package_id").references(() => packages.id, {
      onDelete: "set null",
    }),
    package_version_id: uuid("package_version_id").references(
      () => package_versions.id,
      { onDelete: "set null" },
    ),
    decision: text("decision").notNull(),
    reason: text("reason"),
    source: text("source").notNull(),
    event_type: text("event_type").notNull(),
    decision_cache: boolean("decision_cache"),
    trace_id: text("trace_id"),
    span_id: text("span_id"),
    request_id: text("request_id"),
    serve_mode: text("serve_mode"),
    bytes_transferred: bigint("bytes_transferred", { mode: "number" }),
    project_token_id: uuid("project_token_id").references(
      () => project_tokens.id,
      { onDelete: "set null" },
    ),
    client_ip: text("client_ip"),
    proxy_ip: text("proxy_ip"),
    duration_ms: integer("duration_ms"),
    decision_path: text("decision_path"),
    raw_identity: jsonb("raw_identity"),
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
    index("events_package_id_idx").on(t.package_id),
    index("events_package_version_id_idx").on(t.package_version_id),
    index("events_decision_idx").on(t.decision),
    index("events_project_token_id_idx").on(t.project_token_id),
  ],
);

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
    rule_id: uuid("rule_id").references(() => rules.id, {
      onDelete: "set null",
    }),
    policy_id: uuid("policy_id").references(() => policies.id, {
      onDelete: "set null",
    }),
    rule_name: text("rule_name").notNull().default(""),
    policy_name: text("policy_name").notNull().default(""),
    recommended_remediation: text("recommended_remediation"),
    entity_type: text("entity_type").notNull(),
    package_id: uuid("package_id").references(() => packages.id, {
      onDelete: "set null",
    }),
    package_version_id: uuid("package_version_id").references(
      () => package_versions.id,
      { onDelete: "set null" },
    ),
    severity: text("severity").notNull(),
    code: text("code").notNull(),
    message: text("message").notNull(),
    enforcement_mode: text("enforcement_mode").notNull(),
    blocked: boolean("blocked").notNull(),
    status: text("status").notNull().default("open"),
    status_note: text("status_note"),
    first_seen_at: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("violations_active_package_idx")
      .on(
        t.tenant_id,
        t.project_id,
        t.entity_type,
        sql`COALESCE(${t.package_id}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`COALESCE(${t.package_version_id}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`COALESCE(${t.policy_id}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`COALESCE(${t.rule_id}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        t.enforcement_mode,
        t.code,
      )
      .where(sql`status IN ('open', 'suppressed')`),
    index("violations_project_package_idx").on(
      t.tenant_id,
      t.project_id,
      t.entity_type,
      t.package_id,
      t.package_version_id,
      t.policy_id,
      t.rule_id,
      t.enforcement_mode,
      t.code,
    ),
    index("violations_project_status_idx").on(
      t.project_id,
      t.status,
      t.last_seen_at,
    ),
    index("violations_package_id_idx").on(t.package_id),
    index("violations_package_version_id_idx").on(t.package_version_id),
    index("violations_rule_idx").on(t.rule_id, t.last_seen_at),
    index("violations_tenant_id_idx").on(t.tenant_id),
    index("violations_policy_id_idx").on(t.policy_id, t.last_seen_at),
  ],
);

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
    entity_type: text("entity_type").notNull(),
    package_id: uuid("package_id").references(() => packages.id, {
      onDelete: "set null",
    }),
    package_version_id: uuid("package_version_id").references(
      () => package_versions.id,
      { onDelete: "set null" },
    ),
    decision: text("decision").notNull(),
    policies_evaluated: integer("policies_evaluated").notNull(),
    rules_evaluated: integer("rules_evaluated").notNull(),
    rules_matched: integer("rules_matched").notNull(),
    connector_snapshot_meta: jsonb("connector_snapshot_meta").notNull(),
    field_values_at_evaluation: jsonb("field_values_at_evaluation").notNull(),
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
    index("policy_evaluations_package_id_idx").on(t.package_id),
    index("policy_evaluations_package_version_id_idx").on(
      t.package_version_id,
    ),
    index("policy_evaluations_event_id_idx").on(t.event_id),
    index("policy_evaluations_tenant_id_idx").on(t.tenant_id),
  ],
);

export const violation_occurrences = pgTable(
  "violation_occurrences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    violation_id: uuid("violation_id")
      .notNull()
      .references(() => violations.id, { onDelete: "cascade" }),
    evaluation_id: uuid("evaluation_id")
      .notNull()
      .references(() => policy_evaluations.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("violation_occurrences_violation_evaluation_idx").on(
      t.violation_id,
      t.evaluation_id,
    ),
    index("violation_occurrences_violation_idx").on(t.violation_id),
    index("violation_occurrences_evaluation_idx").on(t.evaluation_id),
    index("violation_occurrences_project_idx").on(t.project_id),
    index("violation_occurrences_tenant_idx").on(t.tenant_id),
  ],
);

export const proxy_status_events = pgTable(
  "proxy_status_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    proxy_id: uuid("proxy_id").notNull(),
    proxy_ip: text("proxy_ip"),
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
