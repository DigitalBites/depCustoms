import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  getAuthContext,
  requireProjectAccess,
  requireTenantCapability,
  requireTenantParamAccess,
} from "../../http/guards.js";
import { createProject, deleteProject, listTenantProjects } from "./service.js";

export const projectRoutes = new Hono();

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
});

projectRoutes.get("/v1/tenants/:tenant_id/projects", async (c) => {
  const tenantId = requireTenantParamAccess(c);
  if (!tenantId) return c.res;

  if (
    !requireTenantCapability(
      c,
      "projects.read",
      "You do not have access to view projects",
    )
  ) {
    return c.res;
  }

  const { userId, role } = getAuthContext(c);
  const rows = await listTenantProjects({ tenantId, userId, role });
  return c.json({ projects: rows });
});

projectRoutes.post(
  "/v1/tenants/:tenant_id/projects",
  zValidator("json", createProjectSchema),
  async (c) => {
    const tenantId = requireTenantParamAccess(c);
    if (!tenantId) return c.res;
    const { userId, role } = getAuthContext(c);

    if (
      !requireTenantCapability(
        c,
        "projects.create",
        "You do not have access to create projects",
      )
    ) {
      return c.res;
    }

    const { name } = c.req.valid("json");
    const project = await createProject({ tenantId, userId, role, name });

    return c.json({ project }, 201);
  },
);

projectRoutes.delete("/v1/projects/:project_id", async (c) => {
  const access = await requireProjectAccess(c, {
    hideForbiddenAsNotFound: true,
  });
  if (!access) return c.res;

  if (
    !requireTenantCapability(
      c,
      "projects.delete",
      "You do not have access to delete projects",
    )
  ) {
    return c.res;
  }

  const { projectId } = access;
  const deleted = await deleteProject(projectId);

  if (!deleted) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Project not found",
          detail: projectId,
        },
      },
      404,
    );
  }

  return c.json({ deleted: true, id: deleted.id });
});
