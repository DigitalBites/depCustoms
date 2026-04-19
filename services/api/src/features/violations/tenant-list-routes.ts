import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireTenantCapabilityAccess } from "../../http/guards.js";
import { enrichViolations } from "./enrichment.js";
import { tenantViolationsQuerySchema } from "./query-schemas.js";
import { listTenantViolations } from "./tenant-shared.js";

export const tenantViolationListRouter = new Hono();

tenantViolationListRouter.get(
  "/v1/tenants/:tenant_id/violations",
  zValidator("query", tenantViolationsQuerySchema),
  async (c) => {
    const tenantId = requireTenantCapabilityAccess(
      c,
      "violations.read_tenant",
      "Access denied",
    );
    if (!tenantId) return c.res;

    const {
      status,
      severity,
      since,
      entity_id: entityId,
      search,
      rule_id: ruleId,
      policy_id: policyId,
      limit,
      offset,
    } = c.req.valid("query");

    const rows = await listTenantViolations(tenantId, {
      status,
      severity,
      since,
      entityId,
      search,
      ruleId,
      policyId,
      limit,
      offset,
    });

    const enriched = await enrichViolations(rows);
    return c.json({ violations: enriched, limit, offset });
  },
);
