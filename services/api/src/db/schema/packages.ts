import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  foreignKey,
} from "./shared.js";
import { tenants, projects } from "./tenancy.js";

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
    index("ppu_package_version_id_idx").on(t.package_version_id),
  ],
);

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
