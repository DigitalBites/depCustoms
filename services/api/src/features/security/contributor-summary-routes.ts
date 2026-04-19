import { Hono } from "hono";
import {
  getAuthContext,
  listAccessibleProjectIds,
  requireTenantCapability,
  requireTenantCapabilityAccess,
  requireProjectAccess,
} from "../../http/guards.js";
import {
  loadProjectContributorSummary,
  loadTenantContributorSummary,
} from "./contributor-package-list-queries.js";
import { buildContributorSummaryResponse } from "./serializers.js";

export const contributorSummaryRouter = new Hono();

// ---------------------------------------------------------------------------
// GET /v1/projects/:project_id/connectors/contributor/summary
// Aggregate contributor risk counts for a single project.
// ---------------------------------------------------------------------------

contributorSummaryRouter.get(
  "/v1/projects/:project_id/connectors/contributor/summary",
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
    const summary = await loadProjectContributorSummary(projectId, tenantId);
    const computedAt = new Date().toISOString();

    return c.json({
      projectId,
      ...buildContributorSummaryResponse(summary, computedAt),
    });
  },
);

// ---------------------------------------------------------------------------
// GET /v1/tenants/:tenant_id/connectors/contributor/summary
// Aggregate contributor risk counts across all accessible projects in the tenant.
// ---------------------------------------------------------------------------

contributorSummaryRouter.get(
  "/v1/tenants/:tenant_id/connectors/contributor/summary",
  async (c) => {
    const tenantId = requireTenantCapabilityAccess(
      c,
      "connectors.read",
      "You do not have access to view contributor connector data",
    );
    if (!tenantId) return c.res;

    const allowedProjectIds = await listAccessibleProjectIds(c);
    const { summary, byProject } = await loadTenantContributorSummary(
      tenantId,
      allowedProjectIds,
    );
    const computedAt = new Date().toISOString();

    return c.json({
      tenantId,
      ...buildContributorSummaryResponse(summary, computedAt, byProject),
    });
  },
);
