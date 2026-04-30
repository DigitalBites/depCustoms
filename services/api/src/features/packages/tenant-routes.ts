import { Hono } from "hono";
import { requireTenantCapabilityAccess } from "../../http/guards.js";
import { listTenantPackages } from "./shared.js";

export const tenantPackagesRouter = new Hono();

tenantPackagesRouter.get("/v1/tenants/:tenant_id/packages", async (c) => {
  const tenantIdResult = requireTenantCapabilityAccess(c, "packages.read_tenant");
  if (!tenantIdResult.ok) return tenantIdResult.response;
  const tenantId = tenantIdResult.value;

  const rows = await listTenantPackages(tenantId);
  return c.json({ packages: rows });
});
