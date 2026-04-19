import { Hono } from "hono";
import {
  requireProjectAccess,
  requireTenantCapability,
} from "../../http/guards.js";
import { getAuthContext } from "../../http/guards.js";
import { rebuildProjectPackages } from "./shared.js";

export const packageRebuildRouter = new Hono();

packageRebuildRouter.post(
  "/v1/projects/:project_id/packages/rebuild",
  async (c) => {
    const access = await requireProjectAccess(c, {
      hideForbiddenAsNotFound: true,
    });
    if (!access) return c.res;
    if (!requireTenantCapability(c, "packages.rebuild", "Access denied"))
      return c.res;

    const { projectId } = access;
    const { tenantId } = getAuthContext(c);
    const rebuilt = await rebuildProjectPackages(projectId, tenantId);

    return c.json({ rebuilt });
  },
);
