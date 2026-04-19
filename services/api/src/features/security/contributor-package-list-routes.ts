import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  getAuthContext,
  requireProjectAccess,
  requireTenantCapability,
} from "../../http/guards.js";
import { contributorPackagesQuerySchema } from "./shared.js";
import { listProjectContributorPackages } from "./contributor-package-list-queries.js";
import { buildContributorPackageResponse } from "./serializers.js";

export const projectContributorPackageListRouter = new Hono();

projectContributorPackageListRouter.get(
  "/v1/projects/:project_id/connectors/contributor/packages",
  zValidator("query", contributorPackagesQuerySchema),
  async (c) => {
    if (
      !requireTenantCapability(
        c,
        "connectors.read",
        "You do not have access to view contributor connector data",
      )
    ) {
      return c.res;
    }

    const access = await requireProjectAccess(c);
    if (!access) return c.res;

    const { projectId } = access;
    const { tenantId } = getAuthContext(c);
    const { score_tier, min_score, limit, offset } = c.req.valid("query");

    const { packages, total } = await listProjectContributorPackages(
      projectId,
      tenantId,
      { scoreTier: score_tier, minScore: min_score, limit, offset },
    );

    return c.json({
      packages: packages.map((pkg) => buildContributorPackageResponse(pkg)),
      pagination: { total, offset, limit },
    });
  },
);
