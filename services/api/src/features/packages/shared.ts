import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../db/index.js";
import {
  events,
  packages,
  package_versions,
  project_package_usage,
} from "../../db/schema.js";
import {
  canonicalizePackageIdentity,
  packageKey,
  packageVersionKey,
} from "./identity.js";

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
        ecosystem: events.ecosystem,
        package: events.package,
        version: events.version,
        request_count: sql<number>`COUNT(*)::int`,
        allow_count: sql<number>`SUM(CASE WHEN ${events.decision} = 'allow' THEN 1 ELSE 0 END)::int`,
        block_count: sql<number>`SUM(CASE WHEN ${events.decision} = 'block' THEN 1 ELSE 0 END)::int`,
        first_seen_at: sql<Date>`MIN(${events.requested_at})`,
      })
      .from(events)
      .where(
        and(
          eq(events.tenant_id, tenantId),
          eq(events.project_id, projectId),
          eq(events.source, "proxy"),
          inArray(events.event_type, ["artifact", "upstream_error"]),
        ),
      )
      .groupBy(events.ecosystem, events.package, events.version);

    await tx
      .delete(project_package_usage)
      .where(
        and(
          eq(project_package_usage.project_id, projectId),
          eq(project_package_usage.tenant_id, tenantId),
        ),
      );

    if (aggregated.length === 0) return 0;

    type AggregatedPackageUsage = {
      ecosystem: string;
      package: string;
      version: string;
      request_count: number;
      allow_count: number;
      block_count: number;
      first_seen_at: Date;
    };

    const foldedByIdentity = new Map<string, AggregatedPackageUsage>();
    for (const row of aggregated) {
      const identity = canonicalizePackageIdentity(row);
      const key = `${identity.ecosystem}|${identity.package}|${identity.version}`;
      const existing = foldedByIdentity.get(key);
      if (existing) {
        existing.request_count += row.request_count;
        existing.allow_count += row.allow_count;
        existing.block_count += row.block_count;
        if (row.first_seen_at < existing.first_seen_at) {
          existing.first_seen_at = row.first_seen_at;
        }
      } else {
        foldedByIdentity.set(key, {
          ...identity,
          request_count: row.request_count,
          allow_count: row.allow_count,
          block_count: row.block_count,
          first_seen_at: row.first_seen_at,
        });
      }
    }

    const folded = [...foldedByIdentity.values()];
    const uniquePackages = [
      ...new Map(
        folded.map((row) => [
          packageKey(row),
          { ecosystem: row.ecosystem, package: row.package },
        ]),
      ).values(),
    ];

    const pkgRows = await tx
      .insert(packages)
      .values(uniquePackages)
      .onConflictDoUpdate({
        target: [packages.ecosystem, packages.package],
        set: { updated_at: packages.updated_at },
      })
      .returning({
        id: packages.id,
        ecosystem: packages.ecosystem,
        package: packages.package,
      });

    const pkgIdMap = new Map(
      pkgRows.map((row) => [packageKey(row), row.id]),
    );

    const versionRows = await tx
      .insert(package_versions)
      .values(
        folded
          .map((row) => {
            const package_id = pkgIdMap.get(packageKey(row));
            if (!package_id) return null;
            return {
              package_id,
              version: row.version,
            };
          })
          .filter(
            (row): row is { package_id: string; version: string } =>
              row !== null,
          ),
      )
      .onConflictDoUpdate({
        target: [package_versions.package_id, package_versions.version],
        set: { updated_at: package_versions.updated_at },
      })
      .returning({
        id: package_versions.id,
        package_id: package_versions.package_id,
        version: package_versions.version,
      });

    const versionIdMap = new Map(
      versionRows.map((row) => [
        packageVersionKey(row.package_id, row.version),
        row.id,
      ]),
    );

    const usageRows = folded
      .map((row) => {
        const package_id = pkgIdMap.get(packageKey(row));
        if (!package_id) return null;
        const package_version_id = versionIdMap.get(
          packageVersionKey(package_id, row.version),
        );
        if (!package_version_id) return null;
        return {
          tenant_id: tenantId,
          project_id: projectId,
          package_version_id,
          request_count: row.request_count,
          allow_count: row.allow_count,
          block_count: row.block_count,
          created_at: row.first_seen_at,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (usageRows.length > 0) {
      await tx.insert(project_package_usage).values(usageRows);
    }

    return usageRows.length;
  });
}
