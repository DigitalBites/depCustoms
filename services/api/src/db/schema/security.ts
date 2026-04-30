import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "./shared.js";
import { tenants, projects } from "./tenancy.js";
import { rules } from "./policies.js";

export const violation_suppressions = pgTable(
  "violation_suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    project_id: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    entity_id: text("entity_id").notNull(),
    rule_id: uuid("rule_id").references(() => rules.id, {
      onDelete: "set null",
    }),
    suppressed_by: uuid("suppressed_by"),
    suppressed_at: timestamp("suppressed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
    connector_key: text("connector_key").notNull(),
    entity_id: text("entity_id").notNull(),
    finding_id: text("finding_id").notNull(),
    severity: text("severity").notNull(),
    title: text("title"),
    status: text("status").notNull().default("open"),
    status_note: text("status_note"),
    status_updated_by: uuid("status_updated_by"),
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

export const alert_configs = pgTable(
  "alert_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    project_id: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    connector_key: text("connector_key"),
    min_severity: text("min_severity").notNull().default("HIGH"),
    channel: text("channel").notNull(),
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

export const connector_cache = pgTable(
  "connector_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connector_id: text("connector_id").notNull(),
    ecosystem: text("ecosystem").notNull(),
    package: text("package").notNull(),
    version: text("version").notNull(),
    max_severity: text("max_severity").notNull(),
    score_tier: text("score_tier"),
    vuln_count: integer("vuln_count").notNull().default(0),
    fix_available: boolean("fix_available").notNull().default(false),
    best_fix_version: text("best_fix_version"),
    data: jsonb("data"),
    ttl_seconds: integer("ttl_seconds"),
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
