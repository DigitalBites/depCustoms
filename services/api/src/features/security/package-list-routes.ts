import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  getAuthContext,
  requireProjectAccess,
  requireTenantCapability,
} from "../../http/guards.js";
import { pagedPackagesQuerySchema } from "./shared.js";
import { loadProjectPackageFindingContext } from "./package-finding-context.js";
import { listProjectVulnerablePackages } from "./package-list-queries.js";
import { buildOsvPackageResponse } from "./serializers.js";

export const projectSecurityPackageListRouter = new Hono();

projectSecurityPackageListRouter.get(
  "/v1/projects/:project_id/connectors/osv/packages",
  zValidator("query", pagedPackagesQuerySchema),
  async (c) => {
    if (!requireTenantCapability(c, "packages.read_project", "Access denied")) {
      return c.res;
    }

    const access = await requireProjectAccess(c);
    if (!access) return c.res;

    const { projectId } = access;
    const { tenantId } = getAuthContext(c);
    const { offset, limit } = c.req.valid("query");
    const { vulnPackages, total } = await listProjectVulnerablePackages(
      projectId,
      tenantId,
      offset,
      limit,
    );

    if (vulnPackages.length === 0) {
      return c.json({ packages: [], pagination: { total, offset, limit } });
    }

    const cacheIds = vulnPackages.map((pkg) => pkg.cacheId);
    const entityIds = vulnPackages.map(
      (pkg) => `${pkg.ecosystem}:${pkg.name}:${pkg.version}`,
    );
    const { cacheFindings, entityContextRows } =
      await loadProjectPackageFindingContext(
        projectId,
        tenantId,
        cacheIds,
        entityIds,
      );

    const cacheFindingsByCache = new Map<string, typeof cacheFindings>();
    for (const finding of cacheFindings) {
      const list = cacheFindingsByCache.get(finding.cacheId) ?? [];
      list.push(finding);
      cacheFindingsByCache.set(finding.cacheId, list);
    }

    const entityContextByEntity = new Map<
      string,
      (typeof entityContextRows)[number]
    >();
    for (const row of entityContextRows) {
      entityContextByEntity.set(row.entity_id, row);
    }

    const packagesResponse = vulnPackages.map((pkg) => {
      const entityId = `${pkg.ecosystem}:${pkg.name}:${pkg.version}`;
      const vulns = cacheFindingsByCache.get(pkg.cacheId) ?? [];
      const entityContext = entityContextByEntity.get(entityId);
      const packageDispositions = entityContext?.dispositions ?? [];
      return buildOsvPackageResponse({
        pkg,
        vulns,
        packageDispositions,
        openViolationCount: Number(entityContext?.open_violation_count ?? 0),
      });
    });

    return c.json({
      packages: packagesResponse,
      pagination: { total, offset, limit },
    });
  },
);
