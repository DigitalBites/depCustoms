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
  foreignKey,
  sql,
} from "./shared.js";
import { tenants, projects } from "./tenancy.js";
import { rules } from "./policies.js";
import { packages, package_versions } from "./packages.js";

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
    package_id: uuid("package_id").references(() => packages.id, {
      onDelete: "set null",
    }),
    package_version_id: uuid("package_version_id"),
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
    foreignKey({
      columns: [t.package_version_id],
      foreignColumns: [package_versions.id],
      name: "vs_pkg_ver_fk",
    }).onDelete("set null"),
    index("vs_project_package_rule_idx").on(
      t.project_id,
      t.package_id,
      t.package_version_id,
      t.rule_id,
    ),
    index("vs_package_id_idx").on(t.package_id),
    index("vs_package_version_id_idx").on(t.package_version_id),
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
    package_id: uuid("package_id").references(() => packages.id, {
      onDelete: "set null",
    }),
    package_version_id: uuid("package_version_id").references(
      () => package_versions.id,
      { onDelete: "set null" },
    ),
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
    uniqueIndex("pf_project_connector_package_finding_idx").on(
      t.project_id,
      t.connector_key,
      t.package_id,
      t.package_version_id,
      t.finding_id,
    ),
    index("pf_project_status_severity_idx").on(
      t.project_id,
      t.status,
      t.severity,
    ),
    index("pf_project_package_connector_idx").on(
      t.project_id,
      t.package_id,
      t.package_version_id,
      t.connector_key,
    ),
    index("pf_package_id_idx").on(t.package_id),
    index("pf_package_version_id_idx").on(t.package_version_id),
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
    package_id: uuid("package_id").references(() => packages.id, {
      onDelete: "set null",
    }),
    package_version_id: uuid("package_version_id").references(
      () => package_versions.id,
      { onDelete: "set null" },
    ),
    risk_tier: text("risk_tier").notNull(),
    risk_score: integer("risk_score"),
    finding_count: integer("finding_count").notNull().default(0),
    remediation_available: boolean("remediation_available")
      .notNull()
      .default(false),
    best_remediation: text("best_remediation"),
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
    uniqueIndex("connector_cache_connector_package_version_idx")
      .on(t.connector_id, t.package_version_id)
      .where(sql`${t.package_version_id} IS NOT NULL`),
    uniqueIndex("connector_cache_connector_package_scope_idx")
      .on(t.connector_id, t.package_id)
      .where(
        sql`${t.package_id} IS NOT NULL AND ${t.package_version_id} IS NULL`,
      ),
    index("connector_cache_queried_idx").on(t.connector_id, t.queried_at),
    index("connector_cache_package_id_idx").on(t.package_id),
    index("connector_cache_package_version_id_idx").on(t.package_version_id),
  ],
);
