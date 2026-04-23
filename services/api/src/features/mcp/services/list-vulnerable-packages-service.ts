import type { McpRequestContext } from "../context.js";
import { requireMcpProjectAccess } from "./project-access.js";
import { listProjectVulnerablePackages } from "../../security/package-list-queries.js";
import { toIsoString } from "../../security/serializers.js";

type ListVulnerablePackagesFilters = {
  limit?: number;
  offset?: number;
};

export async function listVulnerablePackagesForMcp(
  ctx: McpRequestContext,
  projectId: string,
  filters: ListVulnerablePackagesFilters,
) {
  await requireMcpProjectAccess(ctx.principal, projectId);

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const { vulnPackages, total } = await listProjectVulnerablePackages(
    projectId,
    ctx.principal.tenantId,
    offset,
    limit,
  );

  return {
    tenant_id: ctx.principal.tenantId,
    project_id: projectId,
    packages: vulnPackages.map((pkg) => ({
      ecosystem: pkg.ecosystem,
      package: pkg.name,
      version: pkg.version,
      version_published_at: toIsoString(pkg.versionPublishedAt),
      max_severity: pkg.osvMaxSeverity,
      vuln_count: pkg.osvFindingCount,
      fix_available: pkg.osvFixAvailable,
      best_fix_version: pkg.osvBestFixVersion,
      latest_version: pkg.latestVersion,
      latest_version_published_at: toIsoString(pkg.latestVersionPublishedAt),
      last_pulled_at: toIsoString(pkg.lastPulledAt),
    })),
    pagination: {
      total,
      offset,
      limit,
    },
  };
}
