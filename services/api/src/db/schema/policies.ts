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
  check,
  sql,
} from "./shared.js";
import { tenants, projects } from "./tenancy.js";
import { packages, package_versions } from "./packages.js";

export const connector_fields = pgTable(
  "connector_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connector_key: text("connector_key").notNull(),
    field_key: text("field_key").notNull(),
    canonical_ref: text("canonical_ref").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    data_type: text("data_type").notNull(),
    entity_type: text("entity_type").notNull(),
    operators: text("operators").array().notNull(),
    enum_values: jsonb("enum_values"),
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
    entity_type: text("entity_type").notNull(),
    entity_id: text("entity_id").notNull(),
    package_id: uuid("package_id").references(() => packages.id, {
      onDelete: "set null",
    }),
    package_version_id: uuid("package_version_id").references(
      () => package_versions.id,
      { onDelete: "set null" },
    ),
    fields: jsonb("fields").notNull(),
    meta: jsonb("meta").notNull(),
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
    index("connector_snapshots_package_id_idx").on(t.package_id),
    index("connector_snapshots_package_version_id_idx").on(
      t.package_version_id,
    ),
  ],
);

export const policies = pgTable(
  "policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    project_id: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    scope: text("scope").notNull(),
    status: text("status").notNull().default("active"),
    enforcement_mode: text("enforcement_mode").notNull().default("enforcing"),
    priority: integer("priority").notNull().default(100),
    version: integer("version").notNull().default(1),
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
    inheritance_mode: text("inheritance_mode").notNull().default("inherited"),
    severity_override: text("severity_override"),
    threshold_overrides: jsonb("threshold_overrides"),
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
    target_entity: text("target_entity").notNull(),
    condition: jsonb("condition").notNull(),
    action: jsonb("action").notNull(),
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
