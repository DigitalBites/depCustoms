import { Hono } from "hono";
import { requireTenantCapabilityAccess } from "../../http/guards.js";
import { listTenantPackages } from "./shared.js";

export const tenantPackagesRouter = new Hono();

tenantPackagesRouter.get("/v1/tenants/:tenant_id/packages", async (c) => {
  const tenantId = requireTenantCapabilityAccess(c, "packages.read_tenant");
  if (!tenantId) return c.res;

  const rows = await listTenantPackages(tenantId);
  return c.json({ packages: rows });
});
