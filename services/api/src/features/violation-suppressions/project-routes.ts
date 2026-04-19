import { Hono } from "hono";
import {
  getAuthContext,
  requireProjectAccess,
  requireTenantCapability,
} from "../../http/guards.js";
import { listProjectViolationSuppressions } from "./shared.js";

export const projectViolationSuppressionRouter = new Hono();

projectViolationSuppressionRouter.get(
  "/v1/projects/:project_id/violation-suppressions",
  async (c) => {
    if (
      !requireTenantCapability(c, "violations.read_project", "Access denied")
    ) {
      return c.res;
    }

    const access = await requireProjectAccess(c, {
      hideForbiddenAsNotFound: true,
    });
    if (!access) return c.res;

    const { projectId } = access;
    const { tenantId } = getAuthContext(c);
    const rows = await listProjectViolationSuppressions(projectId, tenantId);

    return c.json({ suppressions: rows });
  },
);
