import { Hono } from "hono";
import {
  listAccessibleProjectIds,
  requireTenantCapabilityAccess,
} from "../../http/guards.js";
import { formatViolationSummary } from "./summary-format.js";
import { loadTenantViolationSummary } from "./tenant-shared.js";

export const tenantViolationSummaryRouter = new Hono();

tenantViolationSummaryRouter.get(
  "/v1/tenants/:tenant_id/violations/summary",
  async (c) => {
    const tenantIdResult = requireTenantCapabilityAccess(
      c,
      "violations.read_tenant",
      "Access denied",
    );
    if (!tenantIdResult.ok) return tenantIdResult.response;
    const tenantId = tenantIdResult.value;

    const allowedProjectIds = await listAccessibleProjectIds(c);
    const summary = await loadTenantViolationSummary(
      tenantId,
      allowedProjectIds,
    );
    return c.json(formatViolationSummary(summary));
  },
);
