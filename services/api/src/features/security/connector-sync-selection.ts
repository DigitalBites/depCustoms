import { and, eq, ne } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  connector_cache,
  packages,
  package_versions,
  project_package_usage,
} from "../../db/schema.js";

export type ProjectSyncPackage = {
  packageId: string;
  packageVersionId: string;
  ecosystem: string;
  name: string;
  version: string;
};

export async function selectProjectPackagesForSync(
  projectId: string,
  tenantId: string,
  connectorKey: string,
  scope: "all" | "vulnerable",
): Promise<ProjectSyncPackage[]> {
  const packageRows = await db
    .select({
      packageId: packages.id,
      packageVersionId: package_versions.id,
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
        eq(project_package_usage.project_id, projectId),
        eq(project_package_usage.tenant_id, tenantId),
      ),
    );

  if (scope !== "vulnerable") {
    return packageRows;
  }

  const vulnerableRows = await db
    .selectDistinct({
      packageId: packages.id,
      packageVersionId: package_versions.id,
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
    .innerJoin(
      connector_cache,
      and(
        eq(connector_cache.package_version_id, package_versions.id),
        eq(connector_cache.connector_id, connectorKey),
        ne(connector_cache.risk_tier, "NONE"),
      ),
    )
    .where(
      and(
        eq(project_package_usage.project_id, projectId),
        eq(project_package_usage.tenant_id, tenantId),
      ),
    );

  const vulnerableKeys = new Set(
    vulnerableRows.map((row) => `${row.ecosystem}:${row.name}:${row.version}`),
  );

  return packageRows.filter((row) =>
    vulnerableKeys.has(`${row.ecosystem}:${row.name}:${row.version}`),
  );
}
