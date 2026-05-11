import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  getAuthContext,
  requireProjectAccess,
  requireTenantCapability,
  requireTenantCapabilityAccess,
} from "../../http/guards.js";
import { canPerform, isTenantRole } from "../../middleware/rbac.js";
import { pagedPackagesQuerySchema } from "./shared.js";
import { loadProjectPackageFindingContext } from "./package-finding-context.js";
import { loadTenantPackageContext } from "./tenant-package-shared.js";
import {
  listProjectFindingPackages,
  listTenantFindingPackageProjects,
  listTenantFindingPackages,
} from "./finding-package-queries.js";
import { buildFindingPackageResponse } from "./serializers.js";

export const projectSecurityFindingPackageRouter = new Hono();
export const tenantSecurityFindingPackageRouter = new Hono();

function canReadContributor(c: Parameters<typeof getAuthContext>[0]): boolean {
  const role = c.get("role");
  return isTenantRole(role) && canPerform(role, "connectors.read");
}

function buildProjectResponse(
  packages: Awaited<ReturnType<typeof listProjectFindingPackages>>["packages"],
  cacheFindings: Array<{
    cacheId: string;
    findingId: string;
    severity: string;
    title: string | null;
    publishedAt: Date | null;
    attributes: unknown;
  }>,
  entityContextRows: Awaited<
    ReturnType<typeof loadProjectPackageFindingContext>
  >["entityContextRows"],
  includeContributor: boolean,
) {
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
    entityContextByEntity.set(row.package_version_id, row);
  }

  return packages.map((pkg) => {
    const vulns = pkg.osv_cache_id
      ? (cacheFindingsByCache.get(pkg.osv_cache_id) ?? [])
      : [];
    const entityContext = entityContextByEntity.get(pkg.package_version_id);
    const packageDispositions = entityContext?.dispositions ?? [];
    return buildFindingPackageResponse({
      pkg,
      vulns,
      includeContributor,
      packageDispositions,
      openViolationCount: Number(entityContext?.open_violation_count ?? 0),
    });
  });
}

projectSecurityFindingPackageRouter.get(
  "/v1/projects/:project_id/findings/packages",
  zValidator("query", pagedPackagesQuerySchema),
  async (c) => {
    const capabilityResult = requireTenantCapability(
        c,
        "security.read_project",
        "You do not have access to view project findings",
      );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    const accessResult = await requireProjectAccess(c);
    if (!accessResult.ok) return accessResult.response;
    const access = accessResult.value;

    const { projectId } = access;
    const { tenantId } = getAuthContext(c);
    const { offset, limit } = c.req.valid("query");
    const includeContributor = canReadContributor(c);

    const { packages, total } = await listProjectFindingPackages(
      projectId,
      tenantId,
      { offset, limit, includeContributor },
    );

    if (packages.length === 0) {
      return c.json({ packages: [], pagination: { total, offset, limit } });
    }

    const cacheIds = packages
      .map((pkg) => pkg.osv_cache_id)
      .filter((value): value is string => Boolean(value));
    const packageVersionIds = packages.map((pkg) => pkg.package_version_id);
    const { cacheFindings, entityContextRows } =
      await loadProjectPackageFindingContext(
        projectId,
        tenantId,
        cacheIds,
        packageVersionIds,
      );

    return c.json({
      packages: buildProjectResponse(
        packages,
        cacheFindings,
        entityContextRows,
        includeContributor,
      ),
      pagination: { total, offset, limit },
    });
  },
);

tenantSecurityFindingPackageRouter.get(
  "/v1/tenants/:tenant_id/findings/packages",
  zValidator("query", pagedPackagesQuerySchema),
  async (c) => {
    const tenantIdResult = requireTenantCapabilityAccess(
      c,
      "security.read_tenant",
      "You do not have access to view findings",
    );
    if (!tenantIdResult.ok) return tenantIdResult.response;
    const tenantId = tenantIdResult.value;

    const { offset, limit } = c.req.valid("query");
    const includeContributor = canReadContributor(c);
    const { packages, total } = await listTenantFindingPackages(tenantId, {
      offset,
      limit,
      includeContributor,
    });

    if (packages.length === 0) {
      return c.json({ packages: [], pagination: { total, offset, limit } });
    }

    const cacheIds = packages
      .map((pkg) => pkg.osv_cache_id)
      .filter((value): value is string => Boolean(value));
    const packageVersionIds = packages.map((pkg) => pkg.package_version_id);
    const [{ cacheFindings, violationCountRows }, projectRows] =
      await Promise.all([
        loadTenantPackageContext(tenantId, cacheIds, [], packageVersionIds),
        listTenantFindingPackageProjects(tenantId, packageVersionIds),
      ]);

    const cacheFindingsByCache = new Map<string, typeof cacheFindings>();
    for (const finding of cacheFindings) {
      const list = cacheFindingsByCache.get(finding.cacheId) ?? [];
      list.push(finding);
      cacheFindingsByCache.set(finding.cacheId, list);
    }

    const violationsByPackageVersion = new Map<string, number>();
    for (const row of violationCountRows) {
      if (row.packageVersionId) {
        violationsByPackageVersion.set(row.packageVersionId, Number(row.count));
      }
    }

    const projectsByVersion = new Map<string, { id: string; name: string }[]>();
    for (const row of projectRows) {
      const list = projectsByVersion.get(row.package_version_id) ?? [];
      if (!list.some((project) => project.id === row.project_id)) {
        list.push({ id: row.project_id, name: row.project_name });
      }
      projectsByVersion.set(row.package_version_id, list);
    }

    return c.json({
      packages: packages.map((pkg) => {
        const vulns = pkg.osv_cache_id
          ? (cacheFindingsByCache.get(pkg.osv_cache_id) ?? [])
          : [];

        return buildFindingPackageResponse({
          pkg,
          vulns,
          includeContributor,
          openViolationCount:
            violationsByPackageVersion.get(pkg.package_version_id) ?? 0,
          projects: projectsByVersion.get(pkg.package_version_id) ?? [],
        });
      }),
      pagination: { total, offset, limit },
    });
  },
);
