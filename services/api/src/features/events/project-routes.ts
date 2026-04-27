import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { getAuthContext, requireProjectAccess } from "../../http/guards.js";
import { errorJson } from "../../http/responses.js";
import { canPerform, isTenantRole } from "../../middleware/rbac.js";
import { listEventsWithCount, projectEventsQuerySchema } from "./shared.js";

export const projectEventsRouter = new Hono();

projectEventsRouter.get(
  "/v1/projects/:project_id/events",
  zValidator("query", projectEventsQuerySchema),
  async (c) => {
    const { role } = getAuthContext(c);
    if (!isTenantRole(role) || !canPerform(role, "events.read_project")) {
      return errorJson(
        c,
        403,
        "FORBIDDEN",
        "You do not have access to view project events",
      );
    }

    const accessResult = await requireProjectAccess(c, {
      hideForbiddenAsNotFound: true,
    });
    if (!accessResult.ok) return accessResult.response;
    const access = accessResult.value;

    const { ecosystem, decision, since, limit, offset } = c.req.valid("query");
    const result = await listEventsWithCount({
      projectId: access.projectId,
      ecosystem,
      decision,
      since,
      limit,
      offset,
    });

    return c.json(result);
  },
);
