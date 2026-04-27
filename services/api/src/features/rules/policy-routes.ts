import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { rules } from "../../db/schema.js";
import { getAuthContext, requireTenantCapability } from "../../http/guards.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";
import { loadPolicyForTenant } from "../policies/shared.js";
import { createRuleSchema, reorderRulesSchema } from "./shared.js";

export const policyRulesRouter = new Hono();

policyRulesRouter.get("/v1/policies/:policy_id/rules", async (c) => {
  const policyIdResult = validateUuidParam(c, "policy_id", "Policy ID");
  if (!policyIdResult.ok) return policyIdResult.response;
  const policyId = policyIdResult.value;

  const { tenantId } = getAuthContext(c);
  const policy = await loadPolicyForTenant(policyId, tenantId);
  if (!policy) {
    return errorJson(c, 404, "NOT_FOUND", "Policy not found", policyId);
  }
  const capabilityResult = requireTenantCapability(
      c,
      policy.scope === "project" ? "policy.read_project" : "policy.read_tenant",
      "You do not have access to view rules for this policy",
    );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

  const rows = await db
    .select()
    .from(rules)
    .where(eq(rules.policy_id, policyId))
    .orderBy(asc(rules.order_index));

  return c.json({ rules: rows });
});

policyRulesRouter.post(
  "/v1/policies/:policy_id/rules",
  zValidator("json", createRuleSchema),
  async (c) => {
    const policyIdResult = validateUuidParam(c, "policy_id", "Policy ID");
    if (!policyIdResult.ok) return policyIdResult.response;
    const policyId = policyIdResult.value;

    const { tenantId } = getAuthContext(c);
    const policy = await loadPolicyForTenant(policyId, tenantId);
    if (!policy) {
      return errorJson(c, 404, "NOT_FOUND", "Policy not found", policyId);
    }
    const capabilityResult = requireTenantCapability(
        c,
        "rules.write",
        "You do not have access to create rules",
      );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }
    if (policy.status === "archived") {
      return errorJson(
        c,
        409,
        "INVALID_STATE",
        "Cannot add rules to an archived policy",
      );
    }

    const body = c.req.valid("json");
    const [created] = await db
      .insert(rules)
      .values({
        policy_id: policyId,
        tenant_id: tenantId,
        name: body.name,
        description: body.description ?? null,
        target_entity: body.target_entity,
        condition: body.condition,
        action: body.action,
        enabled: body.enabled ?? true,
        order_index: body.order_index ?? 0,
      })
      .returning();

    return c.json({ rule: created }, 201);
  },
);

policyRulesRouter.patch(
  "/v1/policies/:policy_id/rules/order",
  zValidator("json", reorderRulesSchema),
  async (c) => {
    const policyIdResult = validateUuidParam(c, "policy_id", "Policy ID");
    if (!policyIdResult.ok) return policyIdResult.response;
    const policyId = policyIdResult.value;

    const { tenantId } = getAuthContext(c);
    const policy = await loadPolicyForTenant(policyId, tenantId);
    if (!policy) {
      return errorJson(c, 404, "NOT_FOUND", "Policy not found", policyId);
    }
    const capabilityResult = requireTenantCapability(
        c,
        "rules.write",
        "You do not have access to reorder rules",
      );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    const body = c.req.valid("json");
    const ids = body.order.map((item) => item.id);

    const existing = await db
      .select({ id: rules.id })
      .from(rules)
      .where(and(eq(rules.policy_id, policyId), inArray(rules.id, ids)));

    const existingIds = new Set(existing.map((row) => row.id));
    const unknown = ids.filter((id) => !existingIds.has(id));
    if (unknown.length > 0) {
      return errorJson(
        c,
        404,
        "NOT_FOUND",
        "Some rule IDs do not belong to this policy",
        JSON.stringify(unknown),
      );
    }

    await Promise.all(
      body.order.map(({ id, order_index }) =>
        db
          .update(rules)
          .set({ order_index, updated_at: new Date() })
          .where(eq(rules.id, id)),
      ),
    );

    const updated = await db
      .select()
      .from(rules)
      .where(eq(rules.policy_id, policyId))
      .orderBy(asc(rules.order_index));

    return c.json({ rules: updated });
  },
);
