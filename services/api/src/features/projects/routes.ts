import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  getAuthContext,
  requireProjectAccess,
  requireTenantCapability,
  requireTenantParamAccess,
} from "../../http/guards.js";
import { errorJson } from "../../http/responses.js";
import { createProject, deleteProject, listTenantProjects } from "./service.js";

export const projectRoutes = new Hono();

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
});

projectRoutes.get("/v1/tenants/:tenant_id/projects", async (c) => {
  const tenantIdResult = requireTenantParamAccess(c);
  if (!tenantIdResult.ok) return tenantIdResult.response;
  const tenantId = tenantIdResult.value;

  const capabilityResult = requireTenantCapability(
      c,
      "projects.read",
      "You do not have access to view projects",
    );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

  const { userId, role } = getAuthContext(c);
  const rows = await listTenantProjects({ tenantId, userId, role });
  return c.json({ projects: rows });
});

projectRoutes.post(
  "/v1/tenants/:tenant_id/projects",
  zValidator("json", createProjectSchema),
  async (c) => {
    const tenantIdResult = requireTenantParamAccess(c);
    if (!tenantIdResult.ok) return tenantIdResult.response;
    const tenantId = tenantIdResult.value;
    const { userId, role } = getAuthContext(c);

    const capabilityResult = requireTenantCapability(
        c,
        "projects.create",
        "You do not have access to create projects",
      );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    const { name } = c.req.valid("json");
    const project = await createProject({ tenantId, userId, role, name });

    return c.json({ project }, 201);
  },
);

projectRoutes.delete("/v1/projects/:project_id", async (c) => {
  const accessResult = await requireProjectAccess(c, {
    hideForbiddenAsNotFound: true,
  });
  if (!accessResult.ok) return accessResult.response;
  const access = accessResult.value;

  const capabilityResult = requireTenantCapability(
      c,
      "projects.delete",
      "You do not have access to delete projects",
    );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

  const { projectId } = access;
  const deleted = await deleteProject(projectId);

  if (!deleted) {
    return errorJson(c, 404, "NOT_FOUND", "Project not found", projectId);
  }

  return c.json({ deleted: true, id: deleted.id });
});
