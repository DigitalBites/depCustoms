import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";

type ContributorPackageRow = {
  package_id?: string;
  ecosystem: string;
  name: string;
  version: string;
  version_published_at: Date | string | null;
  score: number;
  score_tier: string;
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
  raw_factors: Record<string, number | null> | null;
  last_scored_at: Date | string | null;
  last_pulled_at: Date | string | null;
  latest_version: string | null;
  total_count: string | number;
};

type ContributorSummaryRow = {
  total_scanned: string | number | null;
  not_scanned_count: string | number | null;
  high_risk_count: string | number | null;
  medium_risk_count: string | number | null;
  low_risk_count: string | number | null;
  clean_count: string | number | null;
  new_maintainer_count: string | number | null;
  first_time_publisher_count: string | number | null;
  publisher_change_count: string | number | null;
  install_scripts_count: string | number | null;
  last_scored_at: Date | string | null;
};

type TenantProjectSummaryRow = {
  project_id: string;
  project_name: string;
  total_scanned: string | number | null;
  high_risk_count: string | number | null;
  medium_risk_count: string | number | null;
  low_risk_count: string | number | null;
  clean_count: string | number | null;
};

type ContributorPublisherRow = {
  ecosystem: string;
  publisher_name: string;
  package_count: string | number;
  first_time_publisher_count: string | number;
  continuity_break_count: string | number;
  last_seen_at: Date | string | null;
  total_count: string | number;
};

export async function listProjectContributorPackages(
  projectId: string,
  tenantId: string,
  opts: {
    scoreTier?: string;
    minScore?: number;
    limit: number;
    offset: number;
  },
) {
  const tierFilter = opts.scoreTier
    ? sql`AND cc.max_severity = ${opts.scoreTier}`
    : sql``;
  const scoreFilter =
    opts.minScore !== undefined
      ? sql`AND cc.vuln_count >= ${opts.minScore}`
      : sql``;

  const rows = await db.execute<ContributorPackageRow>(sql`
    SELECT
      p.ecosystem,
      p.package AS name,
      pv.version,
      pv.published_at AS version_published_at,
      cc.vuln_count AS score,
      cc.max_severity AS score_tier,
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
      cc.data->'findings'->0->'attributes'->'raw_factors' AS raw_factors,
      cc.queried_at AS last_scored_at,
      ppu.updated_at AS last_pulled_at,
      lp.version AS latest_version,
      COUNT(*) OVER () AS total_count
    FROM project_package_usage ppu
    JOIN package_versions pv ON pv.id = ppu.package_version_id
    JOIN packages p ON p.id = pv.package_id
    LEFT JOIN package_versions lp ON lp.id = p.latest_package_version_id
    JOIN connector_cache cc
      ON cc.ecosystem = p.ecosystem
     AND cc.package = p.package
     AND cc.version = pv.version
     AND cc.connector_id = 'contributor'
    LEFT JOIN contributor_release_facts crf
      ON crf.package_version_id = pv.id
    WHERE ppu.project_id = ${projectId}
      AND ppu.tenant_id = ${tenantId}
      ${tierFilter}
      ${scoreFilter}
    ORDER BY cc.vuln_count DESC, ppu.updated_at DESC
    LIMIT ${opts.limit} OFFSET ${opts.offset}
  `);

  const total = rows[0] ? Number(rows[0].total_count ?? 0) : 0;
  return { packages: rows as ContributorPackageRow[], total };
}

export async function listTenantContributorPackages(
  tenantId: string,
  allowedProjectIds: string[] | null,
  opts: {
    scoreTier?: string;
    minScore?: number;
    limit: number;
    offset: number;
  },
) {
  const tierFilter = opts.scoreTier
    ? sql`AND cc.max_severity = ${opts.scoreTier}`
    : sql``;
  const scoreFilter =
    opts.minScore !== undefined
      ? sql`AND cc.vuln_count >= ${opts.minScore}`
      : sql``;
  const projectFilter =
    allowedProjectIds !== null
      ? allowedProjectIds.length > 0
        ? sql`AND ppu.project_id = ANY(ARRAY[${sql.join(
            allowedProjectIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}])`
        : sql`AND false`
      : sql``;

  const rows = await db.execute<ContributorPackageRow>(sql`
    SELECT
      p.id AS package_id,
      p.ecosystem,
      p.package AS name,
      pv.version,
      pv.published_at AS version_published_at,
      cc.vuln_count AS score,
      cc.max_severity AS score_tier,
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
      cc.data->'findings'->0->'attributes'->'raw_factors' AS raw_factors,
      cc.queried_at AS last_scored_at,
      MAX(ppu.updated_at) AS last_pulled_at,
      lp.version AS latest_version,
      COUNT(*) OVER () AS total_count
    FROM project_package_usage ppu
    JOIN package_versions pv ON pv.id = ppu.package_version_id
    JOIN packages p ON p.id = pv.package_id
    LEFT JOIN package_versions lp ON lp.id = p.latest_package_version_id
    JOIN connector_cache cc
      ON cc.ecosystem = p.ecosystem
     AND cc.package = p.package
     AND cc.version = pv.version
     AND cc.connector_id = 'contributor'
    LEFT JOIN contributor_release_facts crf
      ON crf.package_version_id = pv.id
    WHERE ppu.tenant_id = ${tenantId}
      ${projectFilter}
      ${tierFilter}
      ${scoreFilter}
    GROUP BY
      p.id,
      p.ecosystem,
      p.package,
      pv.version,
      pv.published_at,
      cc.vuln_count,
      cc.max_severity,
      cc.data,
      cc.queried_at,
      lp.version,
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
    ORDER BY cc.vuln_count DESC, MAX(ppu.updated_at) DESC
    LIMIT ${opts.limit} OFFSET ${opts.offset}
  `);

  const total = rows[0] ? Number(rows[0].total_count ?? 0) : 0;
  return { packages: rows as ContributorPackageRow[], total };
}

export async function loadProjectContributorSummary(
  projectId: string,
  tenantId: string,
) {
  const rows = await db.execute<ContributorSummaryRow>(sql`
    SELECT
      COUNT(DISTINCT pv.id) FILTER (WHERE cc.id IS NOT NULL) AS total_scanned,
      COUNT(DISTINCT pv.id) FILTER (WHERE cc.id IS NULL) AS not_scanned_count,
      COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'HIGH') AS high_risk_count,
      COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'MEDIUM') AS medium_risk_count,
      COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'LOW') AS low_risk_count,
      COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'NONE') AS clean_count,
      COUNT(DISTINCT pv.id) FILTER (
        WHERE crf.new_maintainer_count IS NOT NULL
          AND crf.new_maintainer_count > 0
      ) AS new_maintainer_count,
      COUNT(DISTINCT pv.id) FILTER (
        WHERE crf.publisher_seen_before_package = false
      ) AS first_time_publisher_count,
      COUNT(DISTINCT pv.id) FILTER (
        WHERE crf.publisher_matches_prior_version = false
      ) AS publisher_change_count,
      COUNT(DISTINCT pv.id) FILTER (
        WHERE crf.has_install_scripts = true
      ) AS install_scripts_count,
      MAX(cc.queried_at) AS last_scored_at
    FROM project_package_usage ppu
    JOIN package_versions pv ON pv.id = ppu.package_version_id
    JOIN packages p ON p.id = pv.package_id
    LEFT JOIN connector_cache cc
      ON cc.ecosystem = p.ecosystem
     AND cc.package = p.package
     AND cc.version = pv.version
     AND cc.connector_id = 'contributor'
    LEFT JOIN contributor_release_facts crf
      ON crf.package_version_id = pv.id
    WHERE ppu.project_id = ${projectId}
      AND ppu.tenant_id = ${tenantId}
  `);

  return rows[0] ?? {};
}

export async function loadTenantContributorSummary(
  tenantId: string,
  allowedProjectIds: string[] | null,
) {
  const projectFilter =
    allowedProjectIds !== null
      ? sql`AND ppu.project_id = ANY(ARRAY[${sql.join(
          allowedProjectIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}])`
      : sql``;

  const [summaryRows, projectRows] = await Promise.all([
    db.execute<ContributorSummaryRow>(sql`
      SELECT
        COUNT(DISTINCT pv.id) FILTER (WHERE cc.id IS NOT NULL) AS total_scanned,
        COUNT(DISTINCT pv.id) FILTER (WHERE cc.id IS NULL) AS not_scanned_count,
        COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'HIGH') AS high_risk_count,
        COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'MEDIUM') AS medium_risk_count,
        COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'LOW') AS low_risk_count,
        COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'NONE') AS clean_count,
        COUNT(DISTINCT pv.id) FILTER (
          WHERE crf.new_maintainer_count IS NOT NULL
            AND crf.new_maintainer_count > 0
        ) AS new_maintainer_count,
        COUNT(DISTINCT pv.id) FILTER (
          WHERE crf.publisher_seen_before_package = false
        ) AS first_time_publisher_count,
        COUNT(DISTINCT pv.id) FILTER (
          WHERE crf.publisher_matches_prior_version = false
        ) AS publisher_change_count,
        COUNT(DISTINCT pv.id) FILTER (
          WHERE crf.has_install_scripts = true
        ) AS install_scripts_count,
        MAX(cc.queried_at) AS last_scored_at
      FROM project_package_usage ppu
      JOIN package_versions pv ON pv.id = ppu.package_version_id
      JOIN packages p ON p.id = pv.package_id
      LEFT JOIN connector_cache cc
        ON cc.ecosystem = p.ecosystem
       AND cc.package = p.package
       AND cc.version = pv.version
       AND cc.connector_id = 'contributor'
      LEFT JOIN contributor_release_facts crf
        ON crf.package_version_id = pv.id
      WHERE ppu.tenant_id = ${tenantId}
        ${projectFilter}
    `),
    db.execute<TenantProjectSummaryRow>(sql`
      SELECT
        ppu.project_id,
        pr.name AS project_name,
        COUNT(DISTINCT pv.id) FILTER (WHERE cc.id IS NOT NULL) AS total_scanned,
        COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'HIGH') AS high_risk_count,
        COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'MEDIUM') AS medium_risk_count,
        COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'LOW') AS low_risk_count,
        COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'NONE') AS clean_count
      FROM project_package_usage ppu
      JOIN package_versions pv ON pv.id = ppu.package_version_id
      JOIN packages p ON p.id = pv.package_id
      JOIN projects pr ON pr.id = ppu.project_id
      LEFT JOIN connector_cache cc
        ON cc.ecosystem = p.ecosystem
       AND cc.package = p.package
       AND cc.version = pv.version
       AND cc.connector_id = 'contributor'
      WHERE ppu.tenant_id = ${tenantId}
        ${projectFilter}
      GROUP BY ppu.project_id, pr.name
      ORDER BY COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'HIGH') DESC
    `),
  ]);

  return {
    summary: summaryRows[0] ?? {},
    byProject: projectRows as TenantProjectSummaryRow[],
  };
}

export async function listTenantContributorPublishers(
  tenantId: string,
  opts: {
    ecosystem?: string;
    onlyFirstTime?: boolean;
    limit: number;
    offset: number;
  },
) {
  const ecosystemFilter = opts.ecosystem
    ? sql`AND p.ecosystem = ${opts.ecosystem}`
    : sql``;
  const firstTimeFilter = opts.onlyFirstTime
    ? sql`AND crf.publisher_seen_before_package = false`
    : sql``;

  const rows = await db.execute<ContributorPublisherRow>(sql`
    WITH tenant_packages AS (
      SELECT DISTINCT
        p.id AS package_id,
        p.ecosystem
      FROM project_package_usage ppu
      JOIN package_versions used_pv ON used_pv.id = ppu.package_version_id
      JOIN packages p ON p.id = used_pv.package_id
      WHERE ppu.tenant_id = ${tenantId}
        ${ecosystemFilter}
    )
    SELECT
      tp.ecosystem,
      crf.publish_actor AS publisher_name,
      COUNT(DISTINCT tp.package_id)::int AS package_count,
      COUNT(*) FILTER (
        WHERE crf.publisher_seen_before_package = false
      )::int AS first_time_publisher_count,
      COUNT(*) FILTER (
        WHERE crf.publisher_matches_prior_version = false
      )::int AS continuity_break_count,
      MAX(crf.published_at) AS last_seen_at,
      COUNT(*) OVER () AS total_count
    FROM tenant_packages tp
    JOIN package_versions pv ON pv.package_id = tp.package_id
    JOIN contributor_release_facts crf
      ON crf.package_version_id = pv.id
    WHERE crf.publish_actor IS NOT NULL
      ${firstTimeFilter}
    GROUP BY tp.ecosystem, crf.publish_actor
    ORDER BY
      COUNT(*) FILTER (
        WHERE crf.publisher_seen_before_package = false
      ) DESC,
      COUNT(*) FILTER (
        WHERE crf.publisher_matches_prior_version = false
      ) DESC,
      COUNT(DISTINCT tp.package_id) DESC
    LIMIT ${opts.limit} OFFSET ${opts.offset}
  `);

  const total = rows[0] ? Number(rows[0].total_count ?? 0) : 0;
  return { publishers: rows as ContributorPublisherRow[], total };
}

export async function listTenantContributorPackageProjects(
  tenantId: string,
  packageIds: string[],
  allowedProjectIds: string[] | null,
) {
  if (packageIds.length === 0) {
    return [];
  }

  const projectFilter =
    allowedProjectIds !== null
      ? allowedProjectIds.length > 0
        ? sql`AND ppu.project_id = ANY(ARRAY[${sql.join(
            allowedProjectIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}])`
        : sql`AND false`
      : sql``;

  return db.execute<{
    package_id: string;
    project_id: string;
    project_name: string;
  }>(sql`
    SELECT DISTINCT
      p.id AS package_id,
      ppu.project_id,
      pr.name AS project_name
    FROM project_package_usage ppu
    JOIN package_versions pv ON pv.id = ppu.package_version_id
    JOIN packages p ON p.id = pv.package_id
    JOIN projects pr ON pr.id = ppu.project_id
    WHERE ppu.tenant_id = ${tenantId}
      AND p.id = ANY(ARRAY[${sql.join(
        packageIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}])
      ${projectFilter}
  `);
}
