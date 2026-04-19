import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { project_package_usage } from "../../db/schema.js";
import {
  getAuthContext,
  requireProjectAccess,
  requireTenantCapability,
} from "../../http/guards.js";
import { listProjectPackages } from "./shared.js";

export const projectPackagesRouter = new Hono();

projectPackagesRouter.get("/v1/projects/:project_id/packages", async (c) => {
  if (!requireTenantCapability(c, "packages.read_project", "Access denied")) {
    return c.res;
  }

  const access = await requireProjectAccess(c, {
    hideForbiddenAsNotFound: true,
  });
  if (!access) return c.res;

  const { projectId } = access;
  const { tenantId } = getAuthContext(c);
  const rows = await listProjectPackages(projectId, tenantId);

  return c.json({ packages: rows });
});

projectPackagesRouter.delete("/v1/projects/:project_id/packages", async (c) => {
  const access = await requireProjectAccess(c, {
    hideForbiddenAsNotFound: true,
  });
  if (!access) return c.res;
  if (!requireTenantCapability(c, "packages.rebuild", "Access denied"))
    return c.res;

  const { projectId } = access;
  const { tenantId } = getAuthContext(c);
  const deleted = await db
    .delete(project_package_usage)
    .where(
      and(
        eq(project_package_usage.project_id, projectId),
        eq(project_package_usage.tenant_id, tenantId),
      ),
    )
    .returning({ id: project_package_usage.id });

  return c.json({ deleted: deleted.length });
});
