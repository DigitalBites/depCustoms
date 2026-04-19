import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";

type FindingPackageRow = {
  entity_id: string;
  package_id?: string;
  package_version_id: string;
  osv_cache_id: string | null;
  ecosystem: string;
  name: string;
  version: string;
  version_published_at: Date | string | null;
  latest_version: string | null;
  latest_version_published_at: Date | string | null;
  last_pulled_at: Date | string | null;
  osv_max_severity: string | null;
  osv_vuln_count: number | null;
  osv_fix_available: boolean | null;
  osv_best_fix_version: string | null;
  contributor_cache_id: string | null;
  contributor_tier: string | null;
  contributor_score: number | null;
  contributor_raw_factors: Record<string, number | null> | null;
  contributor_last_scored_at: Date | string | null;
  publisher: string | null;
  publisher_seen_before_package: boolean | null;
  publisher_seen_count_before: number | null;
  publisher_matches_prior_version: boolean | null;
  maintainer_set_changed: boolean | null;
  new_maintainer_count: number | null;
  removed_maintainer_count: number | null;
  maintainer_count: number | null;
  has_install_scripts: boolean | null;
  has_provenance: boolean | null;
  has_trusted_publisher: boolean | null;
  release_velocity_7d: number | null;
  release_velocity_30d: number | null;
  history_complete: boolean | null;
  total_count: string | number;
};

export async function listProjectFindingPackages(
  projectId: string,
  tenantId: string,
  opts: {
    offset: number;
    limit: number;
    includeContributor: boolean;
  },
) {
  const rows = await db.execute<FindingPackageRow>(sql`
    SELECT
      (p.ecosystem || ':' || p.package || ':' || pv.version) AS entity_id,
      p.id AS package_id,
      pv.id AS package_version_id,
      osv_cc.id AS osv_cache_id,
      p.ecosystem,
      p.package AS name,
      pv.version,
      pv.published_at AS version_published_at,
      latest_pv.version AS latest_version,
      latest_pv.published_at AS latest_version_published_at,
      ppu.updated_at AS last_pulled_at,
      osv_cc.max_severity AS osv_max_severity,
      osv_cc.vuln_count AS osv_vuln_count,
      osv_cc.fix_available AS osv_fix_available,
      osv_cc.best_fix_version AS osv_best_fix_version,
      contributor_cc.id AS contributor_cache_id,
      contributor_cc.max_severity AS contributor_tier,
      contributor_cc.vuln_count AS contributor_score,
      contributor_cc.data->'findings'->0->'attributes'->'raw_factors' AS contributor_raw_factors,
      contributor_cc.queried_at AS contributor_last_scored_at,
      crf.publish_actor AS publisher,
      crf.publisher_seen_before_package,
      crf.publisher_seen_count_before,
      crf.publisher_matches_prior_version,
      crf.maintainer_set_changed,
      crf.new_maintainer_count,
      crf.removed_maintainer_count,
      crf.maintainer_count,
      crf.has_install_scripts,
      crf.has_provenance,
      crf.has_trusted_publisher,
      crf.release_velocity_7d_at_publish AS release_velocity_7d,
      crf.release_velocity_30d_at_publish AS release_velocity_30d,
      crf.history_complete,
      COUNT(*) OVER () AS total_count
    FROM project_package_usage ppu
    JOIN package_versions pv ON pv.id = ppu.package_version_id
    JOIN packages p ON p.id = pv.package_id
    LEFT JOIN package_versions latest_pv ON latest_pv.id = p.latest_package_version_id
    LEFT JOIN connector_cache osv_cc
      ON osv_cc.ecosystem = p.ecosystem
     AND osv_cc.package = p.package
     AND osv_cc.version = pv.version
     AND osv_cc.connector_id = 'osv'
    LEFT JOIN connector_cache contributor_cc
      ON contributor_cc.ecosystem = p.ecosystem
     AND contributor_cc.package = p.package
     AND contributor_cc.version = pv.version
     AND contributor_cc.connector_id = 'contributor'
    LEFT JOIN contributor_release_facts crf
      ON crf.package_version_id = pv.id
    WHERE ppu.project_id = ${projectId}
      AND ppu.tenant_id = ${tenantId}
      AND (
        COALESCE(osv_cc.max_severity, 'NONE') != 'NONE'
        ${
          opts.includeContributor
            ? sql`OR COALESCE(contributor_cc.max_severity, 'NONE') != 'NONE'`
            : sql``
        }
      )
    ORDER BY
      CASE
        WHEN COALESCE(osv_cc.max_severity, 'NONE') = 'CRITICAL' THEN 0
        WHEN COALESCE(osv_cc.max_severity, 'NONE') = 'HIGH'
          OR COALESCE(contributor_cc.max_severity, 'NONE') = 'HIGH' THEN 1
        WHEN COALESCE(osv_cc.max_severity, 'NONE') = 'MEDIUM'
          OR COALESCE(contributor_cc.max_severity, 'NONE') = 'MEDIUM' THEN 2
        WHEN COALESCE(osv_cc.max_severity, 'NONE') = 'LOW'
          OR COALESCE(contributor_cc.max_severity, 'NONE') = 'LOW' THEN 3
        ELSE 4
      END,
      ppu.updated_at DESC
    LIMIT ${opts.limit} OFFSET ${opts.offset}
  `);

  const total = rows[0] ? Number(rows[0].total_count ?? 0) : 0;

  return { packages: rows as FindingPackageRow[], total };
}

export async function listTenantFindingPackages(
  tenantId: string,
  opts: {
    offset: number;
    limit: number;
    includeContributor: boolean;
  },
) {
  const rows = await db.execute<FindingPackageRow>(sql`
    SELECT
      (p.ecosystem || ':' || p.package || ':' || pv.version) AS entity_id,
      p.id AS package_id,
      pv.id AS package_version_id,
      osv_cc.id AS osv_cache_id,
      p.ecosystem,
      p.package AS name,
      pv.version,
      pv.published_at AS version_published_at,
      latest_pv.version AS latest_version,
      latest_pv.published_at AS latest_version_published_at,
      MAX(ppu.updated_at) AS last_pulled_at,
      osv_cc.max_severity AS osv_max_severity,
      osv_cc.vuln_count AS osv_vuln_count,
      osv_cc.fix_available AS osv_fix_available,
      osv_cc.best_fix_version AS osv_best_fix_version,
      contributor_cc.id AS contributor_cache_id,
      contributor_cc.max_severity AS contributor_tier,
      contributor_cc.vuln_count AS contributor_score,
      contributor_cc.data->'findings'->0->'attributes'->'raw_factors' AS contributor_raw_factors,
      contributor_cc.queried_at AS contributor_last_scored_at,
      crf.publish_actor AS publisher,
      crf.publisher_seen_before_package,
      crf.publisher_seen_count_before,
      crf.publisher_matches_prior_version,
      crf.maintainer_set_changed,
      crf.new_maintainer_count,
      crf.removed_maintainer_count,
      crf.maintainer_count,
      crf.has_install_scripts,
      crf.has_provenance,
      crf.has_trusted_publisher,
      crf.release_velocity_7d_at_publish AS release_velocity_7d,
      crf.release_velocity_30d_at_publish AS release_velocity_30d,
      crf.history_complete,
      COUNT(*) OVER () AS total_count
    FROM project_package_usage ppu
    JOIN package_versions pv ON pv.id = ppu.package_version_id
    JOIN packages p ON p.id = pv.package_id
    LEFT JOIN package_versions latest_pv ON latest_pv.id = p.latest_package_version_id
    LEFT JOIN connector_cache osv_cc
      ON osv_cc.ecosystem = p.ecosystem
     AND osv_cc.package = p.package
     AND osv_cc.version = pv.version
     AND osv_cc.connector_id = 'osv'
    LEFT JOIN connector_cache contributor_cc
      ON contributor_cc.ecosystem = p.ecosystem
     AND contributor_cc.package = p.package
     AND contributor_cc.version = pv.version
     AND contributor_cc.connector_id = 'contributor'
    LEFT JOIN contributor_release_facts crf
      ON crf.package_version_id = pv.id
    WHERE ppu.tenant_id = ${tenantId}
      AND (
        COALESCE(osv_cc.max_severity, 'NONE') != 'NONE'
        ${
          opts.includeContributor
            ? sql`OR COALESCE(contributor_cc.max_severity, 'NONE') != 'NONE'`
            : sql``
        }
      )
    GROUP BY
      p.id,
      pv.id,
      osv_cc.id,
      p.ecosystem,
      p.package,
      pv.version,
      pv.published_at,
      latest_pv.version,
      latest_pv.published_at,
      osv_cc.max_severity,
      osv_cc.vuln_count,
      osv_cc.fix_available,
      osv_cc.best_fix_version,
      contributor_cc.id,
      contributor_cc.max_severity,
      contributor_cc.vuln_count,
      contributor_cc.data,
      contributor_cc.queried_at,
      crf.publish_actor,
      crf.publisher_seen_before_package,
      crf.publisher_seen_count_before,
      crf.publisher_matches_prior_version,
      crf.maintainer_set_changed,
      crf.new_maintainer_count,
      crf.removed_maintainer_count,
      crf.maintainer_count,
      crf.has_install_scripts,
      crf.has_provenance,
      crf.has_trusted_publisher,
      crf.release_velocity_7d_at_publish,
      crf.release_velocity_30d_at_publish,
      crf.history_complete
    ORDER BY
      CASE
        WHEN COALESCE(osv_cc.max_severity, 'NONE') = 'CRITICAL' THEN 0
        WHEN COALESCE(osv_cc.max_severity, 'NONE') = 'HIGH'
          OR COALESCE(contributor_cc.max_severity, 'NONE') = 'HIGH' THEN 1
        WHEN COALESCE(osv_cc.max_severity, 'NONE') = 'MEDIUM'
          OR COALESCE(contributor_cc.max_severity, 'NONE') = 'MEDIUM' THEN 2
        WHEN COALESCE(osv_cc.max_severity, 'NONE') = 'LOW'
          OR COALESCE(contributor_cc.max_severity, 'NONE') = 'LOW' THEN 3
        ELSE 4
      END,
      MAX(ppu.updated_at) DESC
    LIMIT ${opts.limit} OFFSET ${opts.offset}
  `);

  const total = rows[0] ? Number(rows[0].total_count ?? 0) : 0;

  return { packages: rows as FindingPackageRow[], total };
}

export async function listTenantFindingPackageProjects(
  tenantId: string,
  packageVersionIds: string[],
) {
  if (packageVersionIds.length === 0) {
    return [];
  }

  return db.execute<{
    package_version_id: string;
    project_id: string;
    project_name: string;
  }>(sql`
    SELECT DISTINCT
      ppu.package_version_id,
      ppu.project_id,
      pr.name AS project_name
    FROM project_package_usage ppu
    JOIN projects pr ON pr.id = ppu.project_id
    WHERE ppu.tenant_id = ${tenantId}
      AND ppu.package_version_id = ANY(ARRAY[${sql.join(
        packageVersionIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}])
  `);
}

export async function loadProjectPackageEvidence(
  projectId: string,
  tenantId: string,
  entityIds: string[],
) {
  if (entityIds.length === 0) {
    return [];
  }

  return db.execute<FindingPackageRow>(sql`
    SELECT
      (p.ecosystem || ':' || p.package || ':' || pv.version) AS entity_id,
      p.id AS package_id,
      pv.id AS package_version_id,
      osv_cc.id AS osv_cache_id,
      p.ecosystem,
      p.package AS name,
      pv.version,
      pv.published_at AS version_published_at,
      latest_pv.version AS latest_version,
      latest_pv.published_at AS latest_version_published_at,
      ppu.updated_at AS last_pulled_at,
      osv_cc.max_severity AS osv_max_severity,
      osv_cc.vuln_count AS osv_vuln_count,
      osv_cc.fix_available AS osv_fix_available,
      osv_cc.best_fix_version AS osv_best_fix_version,
      contributor_cc.id AS contributor_cache_id,
      contributor_cc.max_severity AS contributor_tier,
      contributor_cc.vuln_count AS contributor_score,
      contributor_cc.data->'findings'->0->'attributes'->'raw_factors' AS contributor_raw_factors,
      contributor_cc.queried_at AS contributor_last_scored_at,
      crf.publish_actor AS publisher,
      crf.publisher_seen_before_package,
      crf.publisher_seen_count_before,
      crf.publisher_matches_prior_version,
      crf.maintainer_set_changed,
      crf.new_maintainer_count,
      crf.removed_maintainer_count,
      crf.maintainer_count,
      crf.has_install_scripts,
      crf.has_provenance,
      crf.has_trusted_publisher,
      crf.release_velocity_7d_at_publish AS release_velocity_7d,
      crf.release_velocity_30d_at_publish AS release_velocity_30d,
      crf.history_complete,
      COUNT(*) OVER () AS total_count
    FROM project_package_usage ppu
    JOIN package_versions pv ON pv.id = ppu.package_version_id
    JOIN packages p ON p.id = pv.package_id
    LEFT JOIN package_versions latest_pv ON latest_pv.id = p.latest_package_version_id
    LEFT JOIN connector_cache osv_cc
      ON osv_cc.ecosystem = p.ecosystem
     AND osv_cc.package = p.package
     AND osv_cc.version = pv.version
     AND osv_cc.connector_id = 'osv'
    LEFT JOIN connector_cache contributor_cc
      ON contributor_cc.ecosystem = p.ecosystem
     AND contributor_cc.package = p.package
     AND contributor_cc.version = pv.version
     AND contributor_cc.connector_id = 'contributor'
    LEFT JOIN contributor_release_facts crf
      ON crf.package_version_id = pv.id
    WHERE ppu.project_id = ${projectId}
      AND ppu.tenant_id = ${tenantId}
      AND (p.ecosystem || ':' || p.package || ':' || pv.version) = ANY(ARRAY[${sql.join(
        entityIds.map((id) => sql`${id}`),
        sql`, `,
      )}])
  `);
}

export async function loadTenantPackageEvidence(
  tenantId: string,
  entityIds: string[],
) {
  if (entityIds.length === 0) {
    return [];
  }

  return db.execute<FindingPackageRow>(sql`
    SELECT
      (p.ecosystem || ':' || p.package || ':' || pv.version) AS entity_id,
      p.id AS package_id,
      pv.id AS package_version_id,
      osv_cc.id AS osv_cache_id,
      p.ecosystem,
      p.package AS name,
      pv.version,
      pv.published_at AS version_published_at,
      latest_pv.version AS latest_version,
      latest_pv.published_at AS latest_version_published_at,
      MAX(ppu.updated_at) AS last_pulled_at,
      osv_cc.max_severity AS osv_max_severity,
      osv_cc.vuln_count AS osv_vuln_count,
      osv_cc.fix_available AS osv_fix_available,
      osv_cc.best_fix_version AS osv_best_fix_version,
      contributor_cc.id AS contributor_cache_id,
      contributor_cc.max_severity AS contributor_tier,
      contributor_cc.vuln_count AS contributor_score,
      contributor_cc.data->'findings'->0->'attributes'->'raw_factors' AS contributor_raw_factors,
      contributor_cc.queried_at AS contributor_last_scored_at,
      crf.publish_actor AS publisher,
      crf.publisher_seen_before_package,
      crf.publisher_seen_count_before,
      crf.publisher_matches_prior_version,
      crf.maintainer_set_changed,
      crf.new_maintainer_count,
      crf.removed_maintainer_count,
      crf.maintainer_count,
      crf.has_install_scripts,
      crf.has_provenance,
      crf.has_trusted_publisher,
      crf.release_velocity_7d_at_publish AS release_velocity_7d,
      crf.release_velocity_30d_at_publish AS release_velocity_30d,
      crf.history_complete,
      COUNT(*) OVER () AS total_count
    FROM project_package_usage ppu
    JOIN package_versions pv ON pv.id = ppu.package_version_id
    JOIN packages p ON p.id = pv.package_id
    LEFT JOIN package_versions latest_pv ON latest_pv.id = p.latest_package_version_id
    LEFT JOIN connector_cache osv_cc
      ON osv_cc.ecosystem = p.ecosystem
     AND osv_cc.package = p.package
     AND osv_cc.version = pv.version
     AND osv_cc.connector_id = 'osv'
    LEFT JOIN connector_cache contributor_cc
      ON contributor_cc.ecosystem = p.ecosystem
     AND contributor_cc.package = p.package
     AND contributor_cc.version = pv.version
     AND contributor_cc.connector_id = 'contributor'
    LEFT JOIN contributor_release_facts crf
      ON crf.package_version_id = pv.id
    WHERE ppu.tenant_id = ${tenantId}
      AND (p.ecosystem || ':' || p.package || ':' || pv.version) = ANY(ARRAY[${sql.join(
        entityIds.map((id) => sql`${id}`),
        sql`, `,
      )}])
    GROUP BY
      p.id,
      pv.id,
      p.ecosystem,
      p.package,
      pv.version,
      pv.published_at,
      latest_pv.version,
      latest_pv.published_at,
      osv_cc.id,
      osv_cc.max_severity,
      osv_cc.vuln_count,
      osv_cc.fix_available,
      osv_cc.best_fix_version,
      contributor_cc.id,
      contributor_cc.max_severity,
      contributor_cc.vuln_count,
      contributor_cc.data,
      contributor_cc.queried_at,
      crf.publish_actor,
      crf.publisher_seen_before_package,
      crf.publisher_seen_count_before,
      crf.publisher_matches_prior_version,
      crf.maintainer_set_changed,
      crf.new_maintainer_count,
      crf.removed_maintainer_count,
      crf.maintainer_count,
      crf.has_install_scripts,
      crf.has_provenance,
      crf.has_trusted_publisher,
      crf.release_velocity_7d_at_publish,
      crf.release_velocity_30d_at_publish,
      crf.history_complete
  `);
}
