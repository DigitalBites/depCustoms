import { Hono } from "hono";
import { CAPABILITY } from "@customs/shared-constants";
import {
  getAuthContext,
  requireProjectAccess,
  requireTenantCapability,
} from "../../http/guards.js";
import { listProjectViolationSuppressions } from "./shared.js";
import { buildActorRef } from "../actors/resolver.js";

export const projectViolationSuppressionRouter = new Hono();

projectViolationSuppressionRouter.get(
  "/v1/projects/:project_id/violation-suppressions",
  async (c) => {
    const capabilityResult = requireTenantCapability(
      c,
      CAPABILITY.VIOLATIONS_READ_PROJECT,
      "Access denied",
    );
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

    return c.json({
      suppressions: rows.map((suppression) => ({
        ...suppression,
        created_by: buildActorRef(suppression.created_by_user_id),
        suppressed_by: buildActorRef(suppression.suppressed_by_user_id),
      })),
    });
  },
);
