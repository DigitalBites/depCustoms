import { SERVE_MODE } from "@customs/shared-constants";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  index,
  uniqueIndex,
} from "./shared.js";

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

export const tenant_entitlements = pgTable(
  "tenant_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    allowed_ecosystems: text("allowed_ecosystems").array(),
    serve_mode: text("serve_mode").notNull().default(SERVE_MODE.REDIRECT),
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

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    user_id: uuid("user_id").notNull(),
    role: text("role").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("memberships_tenant_id_idx").on(t.tenant_id),
    index("memberships_user_id_idx").on(t.user_id),
    uniqueIndex("memberships_tenant_user_idx").on(t.tenant_id, t.user_id),
  ],
);

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
    owner_user_id: uuid("owner_user_id").notNull(),
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
    index("project_tokens_project_owner_idx").on(
      t.project_id,
      t.owner_user_id,
    ),
    uniqueIndex("project_tokens_token_hash_idx").on(t.token_hash),
  ],
);
