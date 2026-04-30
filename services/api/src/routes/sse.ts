import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { getAuthContext, requireProjectAccess } from "../http/guards.js";
import { errorJson } from "../http/responses.js";
import { canPerform, isTenantRole } from "../middleware/rbac.js";
import { openEventStream } from "../features/sse/stream-service.js";

export const sseRouter = new Hono();

sseRouter.use("*", authMiddleware);

// ---------------------------------------------------------------------------
// GET /v1/events/stream
// Tenant-wide SSE stream.
// Users with tenant event visibility receive all tenant events.
// Users with only project-scoped event visibility receive their allowed projects.
// ---------------------------------------------------------------------------
sseRouter.get("/v1/events/stream", async (c) => {
  const { role } = getAuthContext(c);
  if (
    !isTenantRole(role) ||
    (!canPerform(role, "events.read_tenant") &&
      !canPerform(role, "events.read_project"))
  ) {
    return errorJson(
      c,
      403,
      "FORBIDDEN",
      "You do not have access to open the event stream",
    );
  }

  return openEventStream(c, null);
});

// ---------------------------------------------------------------------------
// GET /v1/projects/:project_id/events/stream
// Project-scoped SSE stream. Server-side fan-out filters to this project only.
// ---------------------------------------------------------------------------
sseRouter.get("/v1/projects/:project_id/events/stream", async (c) => {
  const { role } = getAuthContext(c);
  if (!isTenantRole(role) || !canPerform(role, "events.read_project")) {
    return errorJson(
      c,
      403,
      "FORBIDDEN",
      "You do not have access to open the project event stream",
    );
  }

  const accessResult = await requireProjectAccess(c, {
    hideForbiddenAsNotFound: true,
  });
  if (!accessResult.ok) return accessResult.response;
  const access = accessResult.value;

  return openEventStream(c, access.projectId);
});
