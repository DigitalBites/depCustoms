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
    const capabilityResult = requireTenantCapability(c, "violations.read_project", "Access denied");
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    const accessResult = await requireProjectAccess(c, {
      hideForbiddenAsNotFound: true,
    });
    if (!accessResult.ok) return accessResult.response;
    const access = accessResult.value;

    const { projectId } = access;
    const { tenantId } = getAuthContext(c);
    const rows = await listProjectViolationSuppressions(projectId, tenantId);

    return c.json({ suppressions: rows });
  },
);
