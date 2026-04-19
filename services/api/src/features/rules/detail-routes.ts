import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { policies, rules } from "../../db/schema.js";
import { getAuthContext, requireTenantCapability } from "../../http/guards.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";
import { patchRuleSchema } from "./shared.js";

export const ruleDetailRouter = new Hono();

async function getRuleForTenant(ruleId: string, tenantId: string) {
  const [rule] = await db
    .select()
    .from(rules)
    .where(and(eq(rules.id, ruleId), eq(rules.tenant_id, tenantId)))
    .limit(1);

  return rule ?? null;
}

ruleDetailRouter.get("/v1/rules/:rule_id", async (c) => {
  const ruleId = validateUuidParam(c, "rule_id", "Rule ID");
  if (!ruleId) return c.res;

  const { tenantId } = getAuthContext(c);
  const rule = await getRuleForTenant(ruleId, tenantId);
  if (!rule) {
    return errorJson(c, 404, "NOT_FOUND", "Rule not found", ruleId);
  }
  if (
    !requireTenantCapability(
      c,
      "rules.read",
      "You do not have access to view this rule",
    )
  ) {
    return c.res;
  }

  return c.json({ rule });
});

ruleDetailRouter.patch(
  "/v1/rules/:rule_id",
  zValidator("json", patchRuleSchema),
  async (c) => {
    const ruleId = validateUuidParam(c, "rule_id", "Rule ID");
    if (!ruleId) return c.res;

    if (
      !requireTenantCapability(
        c,
        "rules.write",
        "You do not have access to modify rules",
      )
    ) {
      return c.res;
    }

    const { tenantId } = getAuthContext(c);
    const existing = await getRuleForTenant(ruleId, tenantId);
    if (!existing) {
      return errorJson(c, 404, "NOT_FOUND", "Rule not found", ruleId);
    }

    const [policy] = await db
      .select({ status: policies.status })
      .from(policies)
      .where(eq(policies.id, existing.policy_id))
      .limit(1);

    if (policy?.status === "archived") {
      return errorJson(
        c,
        409,
        "INVALID_STATE",
        "Cannot modify rules of an archived policy",
      );
    }

    const body = c.req.valid("json");
    const [updated] = await db
      .update(rules)
      .set({ ...body, updated_at: new Date() })
      .where(and(eq(rules.id, ruleId), eq(rules.tenant_id, tenantId)))
      .returning();

    return c.json({ rule: updated });
  },
);

ruleDetailRouter.delete("/v1/rules/:rule_id", async (c) => {
  const ruleId = validateUuidParam(c, "rule_id", "Rule ID");
  if (!ruleId) return c.res;

  if (
    !requireTenantCapability(
      c,
      "rules.write",
      "You do not have access to delete rules",
    )
  ) {
    return c.res;
  }

  const { tenantId } = getAuthContext(c);
  const existing = await getRuleForTenant(ruleId, tenantId);
  if (!existing) {
    return errorJson(c, 404, "NOT_FOUND", "Rule not found", ruleId);
  }

  await db
    .delete(rules)
    .where(and(eq(rules.id, ruleId), eq(rules.tenant_id, tenantId)));
  return c.body(null, 204);
});
