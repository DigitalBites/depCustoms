import { Hono } from "hono";
import { requireTenantCapabilityAccess } from "../../http/guards.js";
import { listTenantViolationSuppressions } from "./shared.js";

export const tenantViolationSuppressionRouter = new Hono();

tenantViolationSuppressionRouter.get(
  "/v1/tenants/:tenant_id/violation-suppressions",
  async (c) => {
    const tenantId = requireTenantCapabilityAccess(
      c,
      "violations.read_tenant",
      "Access denied",
    );
    if (!tenantId) return c.res;

    const rows = await listTenantViolationSuppressions(tenantId);
    return c.json({ suppressions: rows });
  },
);
