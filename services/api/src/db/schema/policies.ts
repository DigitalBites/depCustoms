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
  VALID_TO_INFINITY_SQL,
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
      t.package_id,
      t.package_version_id,
    ),
    index("connector_snapshots_project_package_idx").on(
      t.project_id,
      t.entity_type,
      t.package_id,
      t.package_version_id,
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
    policy_key: uuid("policy_key").notNull().defaultRandom(),
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
    effective_from: timestamp("effective_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    effective_to: timestamp("effective_to", { withTimezone: true })
      .notNull()
      .default(VALID_TO_INFINITY_SQL),
    superseded_by_id: uuid("superseded_by_id"),
    created_by_user_id: uuid("created_by_user_id"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("policies_tenant_id_idx").on(t.tenant_id),
    index("policies_policy_key_idx").on(t.policy_key),
    uniqueIndex("policies_current_policy_key_idx")
      .on(t.policy_key)
      .where(sql`${t.effective_to} = ${VALID_TO_INFINITY_SQL}`),
    uniqueIndex("policies_policy_key_version_idx").on(
      t.policy_key,
      t.version,
    ),
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
    check("policies_valid_window", sql`${t.effective_from} < ${t.effective_to}`),
  ],
);

export const policy_project_bindings = pgTable(
  "policy_project_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    binding_key: uuid("binding_key").notNull().defaultRandom(),
    policy_key: uuid("policy_key").notNull(),
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
    rule_overrides: jsonb("rule_overrides"),
    enforcement_mode_override: text("enforcement_mode_override"),
    version: integer("version").notNull().default(1),
    effective_from: timestamp("effective_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    effective_to: timestamp("effective_to", { withTimezone: true })
      .notNull()
      .default(VALID_TO_INFINITY_SQL),
    superseded_by_id: uuid("superseded_by_id"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("policy_project_bindings_key_version_idx").on(
      t.binding_key,
      t.version,
    ),
    uniqueIndex("policy_project_bindings_current_key_idx")
      .on(t.binding_key)
      .where(sql`${t.effective_to} = ${VALID_TO_INFINITY_SQL}`),
    uniqueIndex("policy_project_bindings_current_policy_project_idx")
      .on(t.tenant_id, t.project_id, t.policy_key)
      .where(sql`${t.effective_to} = ${VALID_TO_INFINITY_SQL}`),
    index("policy_project_bindings_policy_project_idx").on(
      t.policy_key,
      t.project_id,
    ),
    index("policy_project_bindings_tenant_id_idx").on(t.tenant_id),
    index("policy_project_bindings_project_id_idx").on(t.project_id),
    index("policy_project_bindings_policy_key_idx").on(t.policy_key),
    check(
      "policy_project_bindings_valid_window",
      sql`${t.effective_from} < ${t.effective_to}`,
    ),
  ],
);

export const rules = pgTable(
  "rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rule_key: uuid("rule_key").notNull().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    target_entity: text("target_entity").notNull(),
    condition: jsonb("condition").notNull(),
    action: jsonb("action").notNull(),
    version: integer("version").notNull().default(1),
    effective_from: timestamp("effective_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    effective_to: timestamp("effective_to", { withTimezone: true })
      .notNull()
      .default(VALID_TO_INFINITY_SQL),
    superseded_by_id: uuid("superseded_by_id"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("rules_rule_key_idx").on(t.rule_key),
    uniqueIndex("rules_current_rule_key_idx")
      .on(t.rule_key)
      .where(sql`${t.effective_to} = ${VALID_TO_INFINITY_SQL}`),
    uniqueIndex("rules_rule_key_version_idx").on(t.rule_key, t.version),
    index("rules_tenant_id_idx").on(t.tenant_id),
    check("rules_valid_window", sql`${t.effective_from} < ${t.effective_to}`),
  ],
);

export const policy_rule_bindings = pgTable(
  "policy_rule_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    policy_id: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
    rule_id: uuid("rule_id")
      .notNull()
      .references(() => rules.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    required: boolean("required").notNull().default(false),
    order_index: integer("order_index").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("policy_rule_bindings_policy_id_idx").on(t.policy_id),
    index("policy_rule_bindings_rule_id_idx").on(t.rule_id),
    uniqueIndex("policy_rule_bindings_policy_rule_idx").on(
      t.policy_id,
      t.rule_id,
    ),
    uniqueIndex("policy_rule_bindings_policy_order_idx").on(
      t.policy_id,
      t.order_index,
    ),
  ],
);
