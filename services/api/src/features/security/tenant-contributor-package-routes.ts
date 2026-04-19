import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  listAccessibleProjectIds,
  requireTenantCapabilityAccess,
} from "../../http/guards.js";
import { contributorPackagesQuerySchema } from "./shared.js";
import {
  listTenantContributorPackageProjects,
  listTenantContributorPackages,
} from "./contributor-package-list-queries.js";
import { buildContributorPackageResponse } from "./serializers.js";

export const tenantContributorPackageListRouter = new Hono();

tenantContributorPackageListRouter.get(
  "/v1/tenants/:tenant_id/connectors/contributor/packages",
  zValidator("query", contributorPackagesQuerySchema),
  async (c) => {
    const tenantId = requireTenantCapabilityAccess(
      c,
      "connectors.read",
      "You do not have access to view contributor connector data",
    );
    if (!tenantId) return c.res;

    const allowedProjectIds = await listAccessibleProjectIds(c);
    const { score_tier, min_score, limit, offset } = c.req.valid("query");

    const { packages, total } = await listTenantContributorPackages(
      tenantId,
      allowedProjectIds,
      { scoreTier: score_tier, minScore: min_score, limit, offset },
    );

    const packageIds = packages
      .map((pkg) => pkg.package_id)
      .filter((value): value is string => Boolean(value));
    const packageProjects = await listTenantContributorPackageProjects(
      tenantId,
      packageIds,
      allowedProjectIds,
    );

    const projectsByPackage = new Map<string, { id: string; name: string }[]>();
    for (const row of packageProjects) {
      const list = projectsByPackage.get(row.package_id) ?? [];
      if (!list.some((project) => project.id === row.project_id)) {
        list.push({ id: row.project_id, name: row.project_name });
      }
      projectsByPackage.set(row.package_id, list);
    }

    return c.json({
      packages: packages.map((pkg) =>
        buildContributorPackageResponse(
          pkg,
          pkg.package_id ? (projectsByPackage.get(pkg.package_id) ?? []) : [],
        ),
      ),
      pagination: { total, offset, limit },
    });
  },
);
