import {
  DECISION,
  REQUEST_EVENT_SOURCE,
  REQUEST_EVENT_TYPE,
} from "@customs/shared-constants";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../db/index.js";
import {
  events,
  packages,
  package_versions,
  project_package_usage,
} from "../../db/schema.js";

const latestPackageVersions = alias(
  package_versions,
  "latest_package_versions",
);

export async function listProjectPackages(projectId: string, tenantId: string) {
  return db
    .select({
      id: project_package_usage.id,
      package_id: packages.id,
      package_version_id: project_package_usage.package_version_id,
      ecosystem: packages.ecosystem,
      name: packages.package,
      package: packages.package,
      version: package_versions.version,
      used_version: package_versions.version,
      used_version_published_at: package_versions.published_at,
      is_latest: sql<
        boolean | null
      >`${packages.latest_package_version_id} = ${package_versions.id}`,
      latest_package_version_id: packages.latest_package_version_id,
      latest_version: latestPackageVersions.version,
      latest_version_published_at: latestPackageVersions.published_at,
      request_count: project_package_usage.request_count,
      allow_count: project_package_usage.allow_count,
      block_count: project_package_usage.block_count,
      first_seen_at: project_package_usage.created_at,
      last_seen_at: project_package_usage.updated_at,
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
    .where(
      and(
        eq(project_package_usage.project_id, projectId),
        eq(project_package_usage.tenant_id, tenantId),
      ),
    )
    .orderBy(desc(project_package_usage.updated_at));
}

export async function listTenantPackages(tenantId: string) {
  return db
    .select({
      package_id: packages.id,
      package_version_id: project_package_usage.package_version_id,
      ecosystem: packages.ecosystem,
      name: packages.package,
      package: packages.package,
      version: package_versions.version,
      used_version: package_versions.version,
      used_version_published_at: package_versions.published_at,
      is_latest: sql<
        boolean | null
      >`${packages.latest_package_version_id} = ${package_versions.id}`,
      latest_package_version_id: packages.latest_package_version_id,
      latest_version: latestPackageVersions.version,
      latest_version_published_at: latestPackageVersions.published_at,
      request_count: sql<number>`SUM(${project_package_usage.request_count})::int`,
      allow_count: sql<number>`SUM(${project_package_usage.allow_count})::int`,
      block_count: sql<number>`SUM(${project_package_usage.block_count})::int`,
      project_count: sql<number>`COUNT(DISTINCT ${project_package_usage.project_id})::int`,
      first_seen_at: sql<Date>`MIN(${project_package_usage.created_at})`,
      last_seen_at: sql<Date>`MAX(${project_package_usage.updated_at})`,
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
    .where(eq(project_package_usage.tenant_id, tenantId))
    .groupBy(
      packages.id,
      project_package_usage.package_version_id,
      packages.ecosystem,
      packages.package,
      package_versions.id,
      package_versions.version,
      package_versions.published_at,
      packages.latest_package_version_id,
      latestPackageVersions.version,
      latestPackageVersions.published_at,
    )
    .orderBy(sql`MAX(${project_package_usage.updated_at}) DESC`);
}

export async function rebuildProjectPackages(
  projectId: string,
  tenantId: string,
) {
  return db.transaction(async (tx) => {
    const aggregated = await tx
      .select({
        package_version_id: events.package_version_id,
        request_count: sql<number>`COUNT(*)::int`,
        allow_count: sql<number>`SUM(CASE WHEN ${events.decision} = ${DECISION.ALLOW} THEN 1 ELSE 0 END)::int`,
        block_count: sql<number>`SUM(CASE WHEN ${events.decision} = ${DECISION.BLOCK} THEN 1 ELSE 0 END)::int`,
        first_seen_at: sql<Date>`MIN(${events.requested_at})`,
        last_seen_at: sql<Date>`MAX(${events.requested_at})`,
      })
      .from(events)
      .where(
        and(
          eq(events.tenant_id, tenantId),
          eq(events.project_id, projectId),
          eq(events.source, REQUEST_EVENT_SOURCE.PROXY),
          inArray(events.event_type, [
            REQUEST_EVENT_TYPE.ARTIFACT,
            REQUEST_EVENT_TYPE.UPSTREAM_ERROR,
          ]),
          sql`${events.package_version_id} IS NOT NULL`,
        ),
      )
      .groupBy(events.package_version_id);

    await tx
      .delete(project_package_usage)
      .where(
        and(
          eq(project_package_usage.project_id, projectId),
          eq(project_package_usage.tenant_id, tenantId),
        ),
      );

    if (aggregated.length === 0) return 0;

    const usageRows = aggregated.map((row) => ({
      tenant_id: tenantId,
      project_id: projectId,
      package_version_id: row.package_version_id!,
      request_count: row.request_count,
      allow_count: row.allow_count,
      block_count: row.block_count,
      created_at: row.first_seen_at,
      updated_at: row.last_seen_at,
    }));

    await tx.insert(project_package_usage).values(usageRows);

    return usageRows.length;
  });
}
