import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireTenantCapabilityAccess } from "../../http/guards.js";
import { pagedPackagesQuerySchema } from "./shared.js";
import {
  listTenantVulnerablePackages,
  loadTenantPackageContext,
} from "./tenant-package-shared.js";
import { buildOsvPackageResponse } from "./serializers.js";

export const tenantSecurityPackageRouter = new Hono();

tenantSecurityPackageRouter.get(
  "/v1/tenants/:tenant_id/connectors/osv/packages",
  zValidator("query", pagedPackagesQuerySchema),
  async (c) => {
    const tenantIdResult = requireTenantCapabilityAccess(c, "packages.read_tenant");
    if (!tenantIdResult.ok) return tenantIdResult.response;
    const tenantId = tenantIdResult.value;

    const { offset, limit } = c.req.valid("query");
    const { vulnPackages, total } = await listTenantVulnerablePackages(
      tenantId,
      offset,
      limit,
    );

    if (vulnPackages.length === 0) {
      return c.json({ packages: [], pagination: { total, offset, limit } });
    }

    const cacheIds = vulnPackages.map((pkg) => pkg.cacheId);
    const packageIds = vulnPackages.map((pkg) => pkg.packageId);
    const entityIds = vulnPackages.map(
      (pkg) => `${pkg.ecosystem}:${pkg.name}:${pkg.version}`,
    );

    const { cacheFindings, violationCountRows, packageProjects } =
      await loadTenantPackageContext(tenantId, cacheIds, packageIds, entityIds);

    const cacheFindingsByCache = new Map<string, typeof cacheFindings>();
    for (const finding of cacheFindings) {
      const list = cacheFindingsByCache.get(finding.cacheId) ?? [];
      list.push(finding);
      cacheFindingsByCache.set(finding.cacheId, list);
    }

    const violationsByEntity = new Map<string, number>();
    for (const row of violationCountRows) {
      violationsByEntity.set(row.entityId, Number(row.count));
    }

    const projectsByPackage = new Map<string, { id: string; name: string }[]>();
    for (const row of packageProjects) {
      const list = projectsByPackage.get(row.packageId) ?? [];
      if (!list.some((project) => project.id === row.projectId)) {
        list.push({ id: row.projectId, name: row.projectName });
      }
      projectsByPackage.set(row.packageId, list);
    }

    const result = vulnPackages.map((pkg) => {
      const entityId = `${pkg.ecosystem}:${pkg.name}:${pkg.version}`;
      const vulns = cacheFindingsByCache.get(pkg.cacheId) ?? [];

      return buildOsvPackageResponse({
        pkg,
        vulns,
        openViolationCount: violationsByEntity.get(entityId) ?? 0,
        projects: projectsByPackage.get(pkg.packageId) ?? [],
      });
    });

    return c.json({ packages: result, pagination: { total, offset, limit } });
  },
);
