import { and, desc, eq, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../db/index.js";
import {
  connector_cache,
  packages,
  package_versions,
  project_package_usage,
} from "../../db/schema.js";

const latestPackageVersions = alias(
  package_versions,
  "latest_security_package_versions",
);

type ProjectVulnerablePackageRow = {
  packageId: string;
  cacheId: string;
  ecosystem: string;
  name: string;
  version: string;
  versionPublishedAt: Date | string | null;
  osvMaxSeverity: string;
  osvFindingCount: number;
  osvFixAvailable: boolean;
  osvBestFixVersion: string | null;
  latestVersion: string | null;
  latestVersionPublishedAt: Date | string | null;
  lastPulledAt: Date | string | null;
  totalCount: string | number;
};

function baseProjectVulnQuery(projectId: string, tenantId: string) {
  return db
    .select({
      packageId: packages.id,
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
      lastPulledAt: project_package_usage.updated_at,
      totalCount: sql<string>`count(*) over ()`,
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
        eq(connector_cache.ecosystem, packages.ecosystem),
        eq(connector_cache.package, packages.package),
        eq(connector_cache.version, package_versions.version),
        eq(connector_cache.connector_id, "osv"),
      ),
    )
    .where(
      and(
        eq(project_package_usage.project_id, projectId),
        eq(project_package_usage.tenant_id, tenantId),
        ne(connector_cache.max_severity, "NONE"),
      ),
    );
}

export async function listProjectVulnerablePackages(
  projectId: string,
  tenantId: string,
  offset: number,
  limit: number,
) {
  const vulnPackages = await baseProjectVulnQuery(projectId, tenantId)
    .orderBy(
      sql`CASE ${connector_cache.max_severity}
          WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3
          ELSE 4 END`,
      desc(project_package_usage.updated_at),
    )
    .offset(offset)
    .limit(limit);

  const total = vulnPackages[0]
    ? Number((vulnPackages[0] as ProjectVulnerablePackageRow).totalCount ?? 0)
    : 0;

  return { vulnPackages, total };
}

export async function listLegacyProjectVulnerablePackages(
  projectId: string,
  tenantId: string,
  offset: number,
  limit: number,
) {
  const vulnPackages = await baseProjectVulnQuery(projectId, tenantId)
    .orderBy(
      sql`CASE ${connector_cache.max_severity}
          WHEN 'CRITICAL' THEN 0
          WHEN 'HIGH'     THEN 1
          WHEN 'MEDIUM'   THEN 2
          WHEN 'LOW'      THEN 3
          ELSE 4
        END`,
      desc(project_package_usage.updated_at),
    )
    .offset(offset)
    .limit(limit);

  return {
    vulnPackages,
    total:
      vulnPackages.length > 0
        ? Number(
            (vulnPackages[0] as ProjectVulnerablePackageRow).totalCount ?? 0,
          )
        : 0,
  };
}
