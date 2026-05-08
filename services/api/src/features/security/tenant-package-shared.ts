import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../db/index.js";
import {
  connector_cache,
  packages,
  package_versions,
  project_connector_syncs,
  project_package_usage,
  projects,
  violations,
} from "../../db/schema.js";
import { calculateFixNotAppliedSet } from "./shared.js";
import type { CacheFinding } from "../../connectors/cache.js";

const latestPackageVersions = alias(
  package_versions,
  "latest_tenant_security_package_versions",
);

export async function loadTenantOsvSummary(
  tenantId: string,
  allowedProjectIds: string[] | null = null,
) {
  const projectUsageScope =
    allowedProjectIds === null
      ? sql`ppu.tenant_id = ${tenantId}`
      : allowedProjectIds.length > 0
        ? sql`ppu.tenant_id = ${tenantId} AND ppu.project_id IN (${sql.join(
            allowedProjectIds.map((projectId) => sql`${projectId}`),
            sql`, `,
          )})`
        : sql`false`;
  const projectUsageSubqueryScope =
    allowedProjectIds === null
      ? sql`ppu2.tenant_id = ${tenantId}`
      : allowedProjectIds.length > 0
        ? sql`ppu2.tenant_id = ${tenantId} AND ppu2.project_id IN (${sql.join(
            allowedProjectIds.map((projectId) => sql`${projectId}`),
            sql`, `,
          )})`
        : sql`false`;

  const [summaryRows, [syncRow], fixCandidates, projectVersions] =
    await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(DISTINCT pv.id)                                                        AS total_packages,
          COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'CRITICAL')           AS critical_count,
          COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'HIGH')               AS high_count,
          COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'MEDIUM')             AS medium_count,
          COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'LOW')                AS low_count,
          COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'NONE')               AS clean_count,
          COUNT(DISTINCT pv.id) FILTER (WHERE cc.id IS NULL)                          AS unscanned_count,
          COUNT(DISTINCT pv.id) FILTER (
            WHERE cc.max_severity NOT IN ('NONE') AND cc.max_severity IS NOT NULL
              AND cc.fix_available = true
          )                                                                           AS fixable_count,
          COUNT(DISTINCT pv.id) FILTER (
            WHERE EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(cc.data->'findings', '[]'::jsonb)) AS f
              WHERE f->'attributes' @> '{"attack_vector":"NETWORK"}'::jsonb
            )
          )                                                                           AS network_exploitable_count,
          (
            SELECT MIN((f->>'published_at')::timestamptz)
            FROM project_package_usage ppu2
            JOIN package_versions pv2 ON pv2.id = ppu2.package_version_id
            JOIN connector_cache cc2
              ON cc2.package_version_id = pv2.id
             AND cc2.connector_id = 'osv'
             AND cc2.max_severity IN ('CRITICAL', 'HIGH'),
            jsonb_array_elements(COALESCE(cc2.data->'findings', '[]'::jsonb)) AS f
            WHERE ${projectUsageSubqueryScope}
              AND f->>'severity' IN ('CRITICAL', 'HIGH')
          )                                                                           AS oldest_crit_high_advisory
        FROM project_package_usage ppu
        JOIN package_versions pv ON pv.id = ppu.package_version_id
        LEFT JOIN connector_cache cc
               ON cc.package_version_id = pv.id
              AND cc.connector_id = 'osv'
        WHERE ${projectUsageScope}
      `),
      db
        .select({
          lastSyncedAt: sql<
            string | null
          >`MAX(${project_connector_syncs.last_synced_at})`,
        })
        .from(project_connector_syncs)
        .innerJoin(
          projects,
          eq(project_connector_syncs.project_id, projects.id),
        )
        .where(
          and(
            eq(projects.tenant_id, tenantId),
            allowedProjectIds === null
              ? undefined
              : allowedProjectIds.length > 0
                ? inArray(projects.id, allowedProjectIds)
                : sql`false`,
            eq(project_connector_syncs.connector_key, "osv"),
          ),
        ),
      db.execute(sql`
        SELECT DISTINCT
          p.ecosystem,
          p.package   AS name,
          pv.version,
          f->>'fix_version' AS fix_version
        FROM project_package_usage ppu
        JOIN package_versions pv ON pv.id = ppu.package_version_id
        JOIN packages p ON p.id = pv.package_id
        JOIN connector_cache cc
          ON cc.package_version_id = pv.id
         AND cc.connector_id = 'osv',
        jsonb_array_elements(COALESCE(cc.data->'findings', '[]'::jsonb)) AS f
        WHERE ${projectUsageScope}
          AND f->>'fix_version' IS NOT NULL
          AND f->>'fix_version' != ''
      `),
      db
        .select({
          ecosystem: packages.ecosystem,
          name: packages.package,
          version: package_versions.version,
        })
        .from(project_package_usage)
        .innerJoin(
          package_versions,
          eq(project_package_usage.package_version_id, package_versions.id),
        )
        .innerJoin(packages, eq(package_versions.package_id, packages.id))
        .where(
          and(
            eq(project_package_usage.tenant_id, tenantId),
            allowedProjectIds === null
              ? undefined
              : allowedProjectIds.length > 0
                ? inArray(project_package_usage.project_id, allowedProjectIds)
                : sql`false`,
          ),
        ),
    ]);

  const fixNotAppliedSet = calculateFixNotAppliedSet(
    fixCandidates as unknown as Array<{
      ecosystem: string;
      name: string;
      version: string;
      fix_version: string;
    }>,
    projectVersions,
  );

  return {
    summary: summaryRows[0] ?? {},
    rawLastSynced: syncRow?.lastSyncedAt ?? null,
    fixNotAppliedSet,
  };
}

export async function listTenantVulnerablePackages(
  tenantId: string,
  offset: number,
  limit: number,
) {
  const [vulnPackages, [totalRow]] = await Promise.all([
    db
      .select({
        packageId: packages.id,
        packageVersionId: package_versions.id,
        cacheId: connector_cache.id,
        ecosystem: packages.ecosystem,
        name: packages.package,
        version: package_versions.version,
        versionPublishedAt: package_versions.published_at,
        osvMaxSeverity: connector_cache.max_severity,
        osvFindingCount: connector_cache.vuln_count,
        osvFixAvailable: connector_cache.fix_available,
        osvBestFixVersion: connector_cache.best_fix_version,
        latestVersion: latestPackageVersions.version,
        latestVersionPublishedAt: latestPackageVersions.published_at,
        lastPulledAt: sql<Date | null>`MAX(${project_package_usage.updated_at})`,
      })
      .from(project_package_usage)
      .innerJoin(
        package_versions,
        eq(project_package_usage.package_version_id, package_versions.id),
      )
      .innerJoin(packages, eq(package_versions.package_id, packages.id))
      .leftJoin(
        latestPackageVersions,
        eq(packages.latest_package_version_id, latestPackageVersions.id),
      )
      .innerJoin(
        connector_cache,
        and(
          eq(connector_cache.package_version_id, package_versions.id),
          eq(connector_cache.connector_id, "osv"),
        ),
      )
      .where(
        and(
          eq(project_package_usage.tenant_id, tenantId),
          ne(connector_cache.max_severity, "NONE"),
        ),
      )
      .groupBy(
        packages.id,
        package_versions.id,
        connector_cache.id,
        package_versions.published_at,
        latestPackageVersions.version,
        latestPackageVersions.published_at,
      )
      .orderBy(
        sql`CASE ${connector_cache.max_severity}
            WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3
            ELSE 4 END`,
        sql`MAX(${project_package_usage.updated_at}) DESC`,
      )
      .offset(offset)
      .limit(limit),
    db
      .select({ total: sql<string>`count(distinct ${package_versions.id})` })
      .from(project_package_usage)
      .innerJoin(
        package_versions,
        eq(project_package_usage.package_version_id, package_versions.id),
      )
      .innerJoin(packages, eq(package_versions.package_id, packages.id))
      .innerJoin(
        connector_cache,
        and(
          eq(connector_cache.package_version_id, package_versions.id),
          eq(connector_cache.connector_id, "osv"),
        ),
      )
      .where(
        and(
          eq(project_package_usage.tenant_id, tenantId),
          ne(connector_cache.max_severity, "NONE"),
        ),
      ),
  ]);

  return {
    vulnPackages,
    total: Number(totalRow?.total ?? 0),
  };
}

export async function loadTenantPackageContext(
  tenantId: string,
  cacheIds: string[],
  packageIds: string[],
  entityIds: string[],
) {
  const [cacheRows, violationCountRows, packageProjects] = await Promise.all([
    cacheIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: connector_cache.id, data: connector_cache.data })
          .from(connector_cache)
          .where(
            and(
              inArray(connector_cache.id, cacheIds),
              eq(connector_cache.connector_id, "osv"),
            ),
          ),
    db
      .select({
        entityId: violations.entity_id,
        count: sql<string>`count(*)`,
      })
      .from(violations)
      .where(
        and(
          eq(violations.tenant_id, tenantId),
          eq(violations.status, "open"),
          inArray(violations.entity_id, entityIds),
        ),
      )
      .groupBy(violations.entity_id),
    packageIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            packageId: packages.id,
            projectId: projects.id,
            projectName: projects.name,
          })
          .from(project_package_usage)
          .innerJoin(
            projects,
            eq(project_package_usage.project_id, projects.id),
          )
          .innerJoin(
            package_versions,
            eq(project_package_usage.package_version_id, package_versions.id),
          )
          .innerJoin(packages, eq(package_versions.package_id, packages.id))
          .where(
            and(
              eq(project_package_usage.tenant_id, tenantId),
              inArray(packages.id, packageIds),
            ),
          ),
  ]);

  const cacheFindings = cacheRows.flatMap((row) => {
    const findings =
      (row.data as { findings?: CacheFinding[] } | null)?.findings ?? [];
    return findings.map((f) => ({
      cacheId: row.id,
      findingId: f.id,
      severity: f.severity,
      title: f.title,
      publishedAt: f.published_at ? new Date(f.published_at) : null,
      attributes: f.attributes,
    }));
  });

  return { cacheFindings, violationCountRows, packageProjects };
}
