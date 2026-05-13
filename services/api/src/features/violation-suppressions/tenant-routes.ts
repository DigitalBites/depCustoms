import { Hono } from "hono";
import { CAPABILITY } from "@customs/shared-constants";
import { requireTenantCapabilityAccess } from "../../http/guards.js";
import { listTenantViolationSuppressions } from "./shared.js";
import { buildActorRef } from "../actors/resolver.js";

export const tenantViolationSuppressionRouter = new Hono();

tenantViolationSuppressionRouter.get(
  "/v1/tenants/:tenant_id/violation-suppressions",
  async (c) => {
    const tenantIdResult = requireTenantCapabilityAccess(
      c,
      CAPABILITY.VIOLATIONS_READ_TENANT,
      "Access denied",
    );
    if (!tenantIdResult.ok) return tenantIdResult.response;
    const tenantId = tenantIdResult.value;

    const rows = await listTenantViolationSuppressions(tenantId);
    return c.json({
      suppressions: rows.map((suppression) => ({
        ...suppression,
        created_by: buildActorRef(suppression.created_by_user_id),
        suppressed_by: buildActorRef(suppression.suppressed_by_user_id),
      })),
    });
  },
);
