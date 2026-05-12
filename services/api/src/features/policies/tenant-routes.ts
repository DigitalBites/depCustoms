import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  ENFORCEMENT_MODE,
  POLICY_SCOPE,
  POLICY_STATUS,
} from "@customs/shared-constants";
import { db } from "../../db/index.js";
import { policies } from "../../db/schema.js";
import { errorJson } from "../../http/responses.js";
import {
  getAuthContext,
  requireTenantCapabilityAccess,
} from "../../http/guards.js";
import { createPolicySchema, listPoliciesQuerySchema } from "./shared.js";

export const tenantPoliciesRouter = new Hono();

tenantPoliciesRouter.get(
  "/v1/tenants/:tenant_id/policies",
  zValidator("query", listPoliciesQuerySchema),
  async (c) => {
    const tenantIdResult = requireTenantCapabilityAccess(
      c,
      "policy.read_tenant",
      "You do not have access to view tenant policies",
    );
    if (!tenantIdResult.ok) return tenantIdResult.response;
    const tenantId = tenantIdResult.value;

    const { scope, status } = c.req.valid("query");

    const rows = await db
      .select()
      .from(policies)
      .where(
        and(
          eq(policies.tenant_id, tenantId),
          scope
            ? scope === POLICY_SCOPE.GLOBAL
              ? isNull(policies.project_id)
              : eq(policies.scope, scope)
            : undefined,
          status ? eq(policies.status, status) : undefined,
        ),
      )
      .orderBy(asc(policies.priority));

    return c.json({ policies: rows });
  },
);

tenantPoliciesRouter.post(
  "/v1/tenants/:tenant_id/policies",
  zValidator("json", createPolicySchema),
  async (c) => {
    const tenantIdResult = requireTenantCapabilityAccess(
      c,
      "policy.write_tenant",
      "You do not have access to create tenant policies",
    );
    if (!tenantIdResult.ok) return tenantIdResult.response;
    const tenantId = tenantIdResult.value;
    const { userId } = getAuthContext(c);
    const body = c.req.valid("json");

    if (body.scope !== POLICY_SCOPE.GLOBAL) {
      return errorJson(
        c,
        400,
        "INVALID_REQUEST",
        "Use POST /v1/projects/:id/policies for project-scoped policies",
      );
    }

    const [created] = await db
      .insert(policies)
      .values({
        tenant_id: tenantId,
        project_id: null,
        name: body.name,
        description: body.description ?? null,
        category: body.category ?? null,
        scope: POLICY_SCOPE.GLOBAL,
        enforcement_mode: body.enforcement_mode ?? ENFORCEMENT_MODE.ENFORCING,
        priority: body.priority ?? 100,
        status: body.status ?? POLICY_STATUS.ACTIVE,
        created_by: userId,
      })
      .returning();

    return c.json({ policy: created }, 201);
  },
);
