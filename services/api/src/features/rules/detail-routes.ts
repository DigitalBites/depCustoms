import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { POLICY_STATUS } from "@customs/shared-constants";
import { db } from "../../db/index.js";
import { policies, policy_rule_bindings, rules } from "../../db/schema.js";
import { getAuthContext, requireTenantCapability } from "../../http/guards.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";
import { patchRuleSchema } from "./shared.js";
import {
  createNextPolicyVersion,
  loadPolicyRuleBindingsForClone,
} from "../policies/versioning.js";

export const ruleDetailRouter = new Hono();

async function getRuleForTenant(ruleId: string, tenantId: string) {
  const [row] = await db
    .select({ rule: rules, binding: policy_rule_bindings })
    .from(rules)
    .leftJoin(policy_rule_bindings, eq(policy_rule_bindings.rule_id, rules.id))
    .where(and(eq(rules.id, ruleId), eq(rules.tenant_id, tenantId)))
    .limit(1);

  return row
    ? {
        ...row.rule,
        policy_id: row.binding?.policy_id ?? null,
        policy_rule_binding_id: row.binding?.id ?? null,
        enabled: row.binding?.enabled ?? true,
        order_index: row.binding?.order_index ?? 0,
      }
    : null;
}

ruleDetailRouter.get("/v1/rules/:rule_id", async (c) => {
  const ruleIdResult = validateUuidParam(c, "rule_id", "Rule ID");
  if (!ruleIdResult.ok) return ruleIdResult.response;
  const ruleId = ruleIdResult.value;

  const { tenantId } = getAuthContext(c);
  const rule = await getRuleForTenant(ruleId, tenantId);
  if (!rule) {
    return errorJson(c, 404, "NOT_FOUND", "Rule not found", ruleId);
  }
  const capabilityResult = requireTenantCapability(
      c,
      "rules.read",
      "You do not have access to view this rule",
    );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

  return c.json({ rule });
});

ruleDetailRouter.patch(
  "/v1/rules/:rule_id",
  zValidator("json", patchRuleSchema),
  async (c) => {
    const ruleIdResult = validateUuidParam(c, "rule_id", "Rule ID");
    if (!ruleIdResult.ok) return ruleIdResult.response;
    const ruleId = ruleIdResult.value;

    const capabilityResult = requireTenantCapability(
        c,
        "rules.write",
        "You do not have access to modify rules",
      );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    const { tenantId } = getAuthContext(c);
    const existing = await getRuleForTenant(ruleId, tenantId);
    if (!existing) {
      return errorJson(c, 404, "NOT_FOUND", "Rule not found", ruleId);
    }

    const [policy] = await db
      .select({ status: policies.status })
      .from(policies)
      .where(eq(policies.id, existing.policy_id ?? ""))
      .limit(1);

    if (policy?.status === POLICY_STATUS.ARCHIVED) {
      return errorJson(
        c,
        409,
        "INVALID_STATE",
        "Cannot modify rules of an archived policy",
      );
    }

    const body = c.req.valid("json");
    const updated = await db.transaction(async (tx) => {
      const now = new Date();
      const [newRule] = await tx
        .insert(rules)
        .values({
          tenant_id: existing.tenant_id,
          rule_key: existing.rule_key,
          name: body.name ?? existing.name,
          description:
            body.description === undefined
              ? existing.description
              : body.description,
          target_entity: body.target_entity ?? existing.target_entity,
          condition: body.condition ?? existing.condition,
          action: body.action ?? existing.action,
          version: existing.version + 1,
          effective_from: now,
        })
        .returning();
      if (!newRule) throw new Error("rule_version_create_failed");

      await tx
        .update(rules)
        .set({
          effective_to: now,
          superseded_by_id: newRule.id,
          updated_at: now,
        })
        .where(and(eq(rules.id, ruleId), eq(rules.tenant_id, tenantId)));

      if (!existing.policy_id) {
        return {
          ...newRule,
          policy_id: null,
          policy_rule_binding_id: null,
          enabled: body.enabled ?? existing.enabled,
          order_index: existing.order_index,
        };
      }

      const [oldPolicy] = await tx
        .select()
        .from(policies)
        .where(eq(policies.id, existing.policy_id))
        .limit(1);
      if (!oldPolicy) throw new Error("policy_not_found_for_rule");

      const oldBindings = await loadPolicyRuleBindingsForClone(
        tx,
        oldPolicy.id,
      );
      const newPolicy = await createNextPolicyVersion(
        tx,
        oldPolicy,
        tenantId,
        now,
        oldBindings.map((binding) => {
          const isChangedRule = binding.rule_id === existing.id;
          return {
            tenant_id: binding.tenant_id,
            rule_id: isChangedRule ? newRule.id : binding.rule_id,
            enabled: isChangedRule
              ? (body.enabled ?? binding.enabled)
              : binding.enabled,
            required: binding.required,
            order_index: binding.order_index,
          };
        }),
      );

      const [newBinding] = await tx
        .select()
        .from(policy_rule_bindings)
        .where(
          and(
            eq(policy_rule_bindings.policy_id, newPolicy.id),
            eq(policy_rule_bindings.rule_id, newRule.id),
          ),
        )
        .limit(1);

      return {
        ...newRule,
        policy_id: newPolicy.id,
        policy_rule_binding_id: newBinding?.id ?? null,
        enabled: body.enabled ?? existing.enabled,
        order_index: existing.order_index,
      };
    });

    return c.json({ rule: updated });
  },
);

ruleDetailRouter.delete("/v1/rules/:rule_id", async (c) => {
  const ruleIdResult = validateUuidParam(c, "rule_id", "Rule ID");
  if (!ruleIdResult.ok) return ruleIdResult.response;
  const ruleId = ruleIdResult.value;

  const capabilityResult = requireTenantCapability(
      c,
      "rules.write",
      "You do not have access to delete rules",
    );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

  const { tenantId } = getAuthContext(c);
  const existing = await getRuleForTenant(ruleId, tenantId);
  if (!existing) {
    return errorJson(c, 404, "NOT_FOUND", "Rule not found", ruleId);
  }

  const deleted = await db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(rules)
      .set({ effective_to: now, updated_at: now })
      .where(and(eq(rules.id, ruleId), eq(rules.tenant_id, tenantId)));

    if (!existing.policy_id) return { policy_id: null };

    const [oldPolicy] = await tx
      .select()
      .from(policies)
      .where(eq(policies.id, existing.policy_id))
      .limit(1);
    if (!oldPolicy) return { policy_id: null };

    const oldBindings = await loadPolicyRuleBindingsForClone(
      tx,
      oldPolicy.id,
    );
    const newPolicy = await createNextPolicyVersion(
      tx,
      oldPolicy,
      tenantId,
      now,
      oldBindings
        .filter((binding) => binding.rule_id !== existing.id)
        .map((binding) => ({
          tenant_id: binding.tenant_id,
          rule_id: binding.rule_id,
          enabled: binding.enabled,
          required: binding.required,
          order_index: binding.order_index,
        })),
    );
    return { policy_id: newPolicy.id };
  });
  return c.json(deleted);
});
