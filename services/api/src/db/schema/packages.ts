import {
  ARTIFACT_KIND,
  ARTIFACT_KINDS,
  DISPLAY_ROLE,
  DISPLAY_ROLES,
  PACKAGE_VERSION_METADATA_KINDS,
  PACKAGE_VERSION_REF_KINDS,
  PACKAGE_VERSION_REF_SOURCES,
  PACKAGE_VERSION_RELATIONSHIP_TYPES,
  VERSION_KIND,
  VERSION_KINDS,
} from "@customs/shared-constants";
import type {
  ArtifactKind,
  DisplayRole,
  PackageVersionMetadataKind,
  PackageVersionRefKind,
  PackageVersionRefSource,
  PackageVersionRelationshipType,
  VersionKind,
} from "@customs/shared-constants";
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
  check,
  foreignKey,
  sql,
} from "./shared.js";
import { tenants, projects } from "./tenancy.js";

function textEnumValues(values: readonly string[]): string {
  return values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");
}

export const packages = pgTable(
  "packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecosystem: text("ecosystem").notNull(),
    package: text("package").notNull(),
    latest_package_version_id: uuid("latest_package_version_id"),
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
    check(
      "packages_ecosystem_canonical_chk",
      sql`${t.ecosystem} = lower(btrim(${t.ecosystem})) AND ${t.ecosystem} <> ''`,
    ),
    check(
      "packages_package_canonical_chk",
      sql`${t.package} = lower(btrim(${t.package})) AND ${t.package} <> ''`,
    ),
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
    version_kind: text("version_kind")
      .$type<VersionKind>()
      .notNull()
      .default(VERSION_KIND.VERSION),
    artifact_kind: text("artifact_kind")
      .$type<ArtifactKind>()
      .notNull()
      .default(ARTIFACT_KIND.PACKAGE_RELEASE),
    display_role: text("display_role")
      .$type<DisplayRole>()
      .notNull()
      .default(DISPLAY_ROLE.PRIMARY),
    published_at: timestamp("published_at", { withTimezone: true }),
    last_metadata_seen_at: timestamp("last_metadata_seen_at", {
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
    check(
      "package_versions_version_canonical_chk",
      sql`${t.version} = btrim(${t.version}) AND ${t.version} <> ''`,
    ),
    uniqueIndex("package_versions_pkg_ver_idx").on(t.package_id, t.version),
    index("package_versions_package_id_idx").on(t.package_id),
    index("package_versions_package_display_role_idx").on(
      t.package_id,
      t.display_role,
    ),
    index("package_versions_version_idx").on(t.version),
    check(
      "package_versions_version_kind_chk",
      sql.raw(`version_kind IN (${textEnumValues(VERSION_KINDS)})`),
    ),
    check(
      "package_versions_artifact_kind_chk",
      sql.raw(`artifact_kind IN (${textEnumValues(ARTIFACT_KINDS)})`),
    ),
    check(
      "package_versions_display_role_chk",
      sql.raw(`display_role IN (${textEnumValues(DISPLAY_ROLES)})`),
    ),
  ],
);

export const package_version_refs = pgTable(
  "package_version_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    package_id: uuid("package_id").notNull(),
    package_version_id: uuid("package_version_id").notNull(),
    ref: text("ref").notNull(),
    ref_kind: text("ref_kind").$type<PackageVersionRefKind>().notNull(),
    source: text("source").$type<PackageVersionRefSource>().notNull(),
    is_display_preferred: boolean("is_display_preferred")
      .notNull()
      .default(false),
    metadata: jsonb("metadata"),
    first_seen_at: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "package_version_refs_ref_canonical_chk",
      sql`${t.ref} = btrim(${t.ref}) AND ${t.ref} <> ''`,
    ),
    check(
      "package_version_refs_ref_kind_chk",
      sql.raw(`ref_kind IN (${textEnumValues(PACKAGE_VERSION_REF_KINDS)})`),
    ),
    check(
      "package_version_refs_source_chk",
      sql.raw(`source IN (${textEnumValues(PACKAGE_VERSION_REF_SOURCES)})`),
    ),
    foreignKey({
      name: "pvr_package_fk",
      columns: [t.package_id],
      foreignColumns: [packages.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pvr_package_version_fk",
      columns: [t.package_version_id],
      foreignColumns: [package_versions.id],
    }).onDelete("cascade"),
    uniqueIndex("package_version_refs_unique_idx").on(
      t.package_id,
      t.ref,
      t.ref_kind,
      t.package_version_id,
      t.source,
    ),
    uniqueIndex("package_version_refs_display_preferred_idx")
      .on(t.package_version_id)
      .where(sql`${t.is_display_preferred} = true`),
    index("package_version_refs_package_ref_idx").on(
      t.package_id,
      t.ref,
      t.ref_kind,
    ),
    index("package_version_refs_package_version_id_idx").on(
      t.package_version_id,
    ),
    index("package_version_refs_version_display_idx").on(
      t.package_version_id,
      t.is_display_preferred,
    ),
  ],
);

export const package_version_metadata = pgTable(
  "package_version_metadata",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    package_version_id: uuid("package_version_id").notNull(),
    metadata_kind: text("metadata_kind")
      .$type<PackageVersionMetadataKind>()
      .notNull(),
    data: jsonb("data").notNull(),
    observed_at: timestamp("observed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "package_version_metadata_kind_chk",
      sql.raw(
        `metadata_kind IN (${textEnumValues(PACKAGE_VERSION_METADATA_KINDS)})`,
      ),
    ),
    foreignKey({
      name: "pvm_package_version_fk",
      columns: [t.package_version_id],
      foreignColumns: [package_versions.id],
    }).onDelete("cascade"),
    uniqueIndex("package_version_metadata_version_kind_idx").on(
      t.package_version_id,
      t.metadata_kind,
    ),
    index("package_version_metadata_package_version_id_idx").on(
      t.package_version_id,
    ),
  ],
);

export const package_version_relationships = pgTable(
  "package_version_relationships",
  {
    parent_package_version_id: uuid("parent_package_version_id").notNull(),
    child_package_version_id: uuid("child_package_version_id").notNull(),
    relationship_type: text("relationship_type")
      .$type<PackageVersionRelationshipType>()
      .notNull(),
    observed_at: timestamp("observed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "package_version_relationships_type_chk",
      sql.raw(
        `relationship_type IN (${textEnumValues(PACKAGE_VERSION_RELATIONSHIP_TYPES)})`,
      ),
    ),
    foreignKey({
      name: "pvr_parent_package_version_fk",
      columns: [t.parent_package_version_id],
      foreignColumns: [package_versions.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pvr_child_package_version_fk",
      columns: [t.child_package_version_id],
      foreignColumns: [package_versions.id],
    }).onDelete("cascade"),
    uniqueIndex("package_version_relationships_unique_idx").on(
      t.parent_package_version_id,
      t.child_package_version_id,
      t.relationship_type,
    ),
    index("package_version_relationships_parent_idx").on(
      t.parent_package_version_id,
    ),
    index("package_version_relationships_child_idx").on(
      t.child_package_version_id,
    ),
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

export const contributor_package_facts = pgTable(
  "contributor_package_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    package_id: uuid("package_id")
      .notNull()
      .references(() => packages.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint"),
    history_complete: boolean("history_complete").notNull().default(false),
    oldest_included_published_at: timestamp("oldest_included_published_at", {
      withTimezone: true,
    }),
    observed_at: timestamp("observed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("cpf_package_id_idx").on(t.package_id),
    index("cpf_observed_at_idx").on(t.observed_at),
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
    contributor_slice_fingerprint: text("contributor_slice_fingerprint"),
    contributor_slice_observed_at: timestamp("contributor_slice_observed_at", {
      withTimezone: true,
    }),
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
