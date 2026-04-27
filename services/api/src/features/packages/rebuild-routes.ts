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
    const accessResult = await requireProjectAccess(c, {
      hideForbiddenAsNotFound: true,
    });
    if (!accessResult.ok) return accessResult.response;
    const access = accessResult.value;
    const capabilityResult = requireTenantCapability(c, "packages.rebuild", "Access denied");
    if (!capabilityResult.ok) return capabilityResult.response;

    const { projectId } = access;
    const { tenantId } = getAuthContext(c);
    const rebuilt = await rebuildProjectPackages(projectId, tenantId);

    return c.json({ rebuilt });
  },
);
