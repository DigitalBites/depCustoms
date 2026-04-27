import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  getAuthContext,
  listAccessibleProjectIds,
  requireResolvedProjectAccess,
} from "../../http/guards.js";
import { errorJson } from "../../http/responses.js";
import { canPerform, isTenantRole } from "../../middleware/rbac.js";
import { listEventsWithCount, tenantEventsQuerySchema } from "./shared.js";

export const tenantEventsRouter = new Hono();

tenantEventsRouter.get(
  "/v1/events",
  zValidator("query", tenantEventsQuerySchema),
  async (c) => {
    const { tenantId, role } = getAuthContext(c);
    const {
      project_id: projectIdFilter,
      ecosystem,
      decision,
      since,
      limit,
      offset,
    } = c.req.valid("query");

    if (
      !isTenantRole(role) ||
      (!canPerform(role, "events.read_tenant") &&
        !canPerform(role, "events.read_project"))
    ) {
      return errorJson(
        c,
        403,
        "FORBIDDEN",
        "You do not have access to view events",
      );
    }

    let allowedProjectIds = await listAccessibleProjectIds(c);
    let projectId: string | undefined;

    if (projectIdFilter) {
      const accessResult = await requireResolvedProjectAccess(c, projectIdFilter, {
        hideForbiddenAsNotFound: true,
      });
      if (!accessResult.ok) return accessResult.response;
      const access = accessResult.value;
      projectId = access.projectId;
      allowedProjectIds = null;
    } else if (allowedProjectIds !== null && allowedProjectIds.length === 0) {
      return c.json({ events: [], total: 0 });
    }

    const result = await listEventsWithCount({
      tenantId,
      projectId,
      allowedProjectIds,
      ecosystem,
      decision,
      since,
      limit,
      offset,
    });

    return c.json(result);
  },
);
