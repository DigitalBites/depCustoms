import { Hono } from "hono";
import { requireTenantCapabilityAccess } from "../../http/guards.js";
import { listTenantViolationSuppressions } from "./shared.js";

export const tenantViolationSuppressionRouter = new Hono();

tenantViolationSuppressionRouter.get(
  "/v1/tenants/:tenant_id/violation-suppressions",
  async (c) => {
    const tenantIdResult = requireTenantCapabilityAccess(
      c,
      "violations.read_tenant",
      "Access denied",
    );
    if (!tenantIdResult.ok) return tenantIdResult.response;
    const tenantId = tenantIdResult.value;

    const rows = await listTenantViolationSuppressions(tenantId);
    return c.json({ suppressions: rows });
  },
);
