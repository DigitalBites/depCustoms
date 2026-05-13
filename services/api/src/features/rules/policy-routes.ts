import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray } from "drizzle-orm";
import { POLICY_STATUS } from "@customs/shared-constants";
import { db } from "../../db/index.js";
import { policy_rule_bindings, rules } from "../../db/schema.js";
import { getAuthContext, requireTenantCapability } from "../../http/guards.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";
import { loadPolicyForTenant } from "../policies/shared.js";
import {
  createNextPolicyVersion,
  loadPolicyRuleBindingsForClone,
} from "../policies/versioning.js";
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
    .select({
      binding: policy_rule_bindings,
      rule: rules,
    })
    .from(policy_rule_bindings)
    .innerJoin(rules, eq(policy_rule_bindings.rule_id, rules.id))
    .where(eq(policy_rule_bindings.policy_id, policyId))
    .orderBy(asc(policy_rule_bindings.order_index));

  return c.json({
    rules: rows.map(({ binding, rule }) => ({
      ...rule,
      policy_id: binding.policy_id,
      policy_rule_binding_id: binding.id,
      enabled: binding.enabled,
      order_index: binding.order_index,
    })),
  });
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
    if (policy.status === POLICY_STATUS.ARCHIVED) {
      return errorJson(
        c,
        409,
        "INVALID_STATE",
        "Cannot add rules to an archived policy",
      );
    }

    const body = c.req.valid("json");
    const created = await db.transaction(async (tx) => {
      const now = new Date();
      const [rule] = await tx
        .insert(rules)
        .values({
          tenant_id: tenantId,
          name: body.name,
          description: body.description ?? null,
          target_entity: body.target_entity,
          condition: body.condition,
          action: body.action,
        })
        .returning();
      if (!rule) throw new Error("rule_create_failed");

      const existingBindings = await loadPolicyRuleBindingsForClone(
        tx,
        policy.id,
      );
      const nextBindings = [
        ...existingBindings.map((binding) => ({
          tenant_id: binding.tenant_id,
          rule_id: binding.rule_id,
          enabled: binding.enabled,
          required: binding.required,
          order_index: binding.order_index,
        })),
        {
          tenant_id: tenantId,
          rule_id: rule.id,
          enabled: body.enabled ?? true,
          required: false,
          order_index: body.order_index ?? existingBindings.length,
        },
      ];
      const nextPolicy = await createNextPolicyVersion(
        tx,
        policy,
        tenantId,
        now,
        nextBindings,
      );
      const [binding] = await tx
        .select()
        .from(policy_rule_bindings)
        .where(
          and(
            eq(policy_rule_bindings.policy_id, nextPolicy.id),
            eq(policy_rule_bindings.rule_id, rule.id),
          ),
        )
        .limit(1);
      if (!binding) throw new Error("rule_binding_create_failed");

      return {
        ...rule,
        policy_id: binding.policy_id,
        policy_rule_binding_id: binding.id,
        enabled: binding.enabled,
        order_index: binding.order_index,
      };
    });

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
      .from(policy_rule_bindings)
      .innerJoin(rules, eq(policy_rule_bindings.rule_id, rules.id))
      .where(
        and(
          eq(policy_rule_bindings.policy_id, policyId),
          inArray(rules.id, ids),
        ),
      );

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

    const nextPolicy = await db.transaction(async (tx) => {
      const now = new Date();
      const existingBindings = await loadPolicyRuleBindingsForClone(
        tx,
        policy.id,
      );
      const orderByRuleId = new Map(
        body.order.map((item) => [item.id, item.order_index]),
      );
      return createNextPolicyVersion(
        tx,
        policy,
        tenantId,
        now,
        existingBindings.map((binding) => ({
          tenant_id: binding.tenant_id,
          rule_id: binding.rule_id,
          enabled: binding.enabled,
          required: binding.required,
          order_index: orderByRuleId.get(binding.rule_id) ?? binding.order_index,
        })),
      );
    });

    const updated = await db
      .select({ binding: policy_rule_bindings, rule: rules })
      .from(policy_rule_bindings)
      .innerJoin(rules, eq(policy_rule_bindings.rule_id, rules.id))
      .where(eq(policy_rule_bindings.policy_id, nextPolicy.id))
      .orderBy(asc(policy_rule_bindings.order_index));

    return c.json({
      rules: updated.map(({ binding, rule }) => ({
        ...rule,
        policy_id: binding.policy_id,
        policy_rule_binding_id: binding.id,
        enabled: binding.enabled,
        order_index: binding.order_index,
      })),
    });
  },
);
