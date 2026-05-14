import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { POLICY_STATUS } from "@customs/shared-constants";
import { db } from "../../db/index.js";
import {
  policies,
  policy_project_bindings,
  policy_rule_bindings,
  rules,
  violations,
} from "../../db/schema.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";
import { getAuthContext, requireTenantCapability } from "../../http/guards.js";
import { enrichViolations } from "../../routes/violations.js";
import {
  loadPolicyForTenant,
  patchPolicySchema,
  policyViolationsQuerySchema,
} from "./shared.js";
import {
  createNextPolicyVersion,
  loadPolicyRuleBindingsForClone,
} from "./versioning.js";

export const policyDetailRouter = new Hono();

policyDetailRouter.get("/v1/policies/:policy_id", async (c) => {
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
      "You do not have access to view this policy",
    );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

  const policyRules = await db
    .select({ binding: policy_rule_bindings, rule: rules })
    .from(policy_rule_bindings)
    .innerJoin(rules, eq(policy_rule_bindings.rule_id, rules.id))
    .where(eq(policy_rule_bindings.policy_id, policyId))
    .orderBy(asc(policy_rule_bindings.order_index));

  return c.json({
    policy: {
      ...policy,
      rules: policyRules.map(({ binding, rule }) => ({
        ...rule,
        policy_id: binding.policy_id,
        policy_rule_binding_id: binding.id,
        enabled: binding.enabled,
        order_index: binding.order_index,
      })),
    },
  });
});

policyDetailRouter.patch(
  "/v1/policies/:policy_id",
  zValidator("json", patchPolicySchema),
  async (c) => {
    const policyIdResult = validateUuidParam(c, "policy_id", "Policy ID");
    if (!policyIdResult.ok) return policyIdResult.response;
    const policyId = policyIdResult.value;
    const { tenantId } = getAuthContext(c);

    const existing = await loadPolicyForTenant(policyId, tenantId);
    if (!existing) {
      return errorJson(c, 404, "NOT_FOUND", "Policy not found", policyId);
    }
    const capabilityResult = requireTenantCapability(
        c,
        existing.scope === "project"
          ? "policy.write_project"
          : "policy.write_tenant",
        "You do not have access to modify this policy",
      );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }
    if (existing.status === POLICY_STATUS.ARCHIVED) {
      return errorJson(
        c,
        409,
        "INVALID_STATE",
        "Archived policies cannot be modified",
      );
    }

    const body = c.req.valid("json");
    const updated = await db.transaction(async (tx) => {
      const now = new Date();
      const existingBindings = await loadPolicyRuleBindingsForClone(
        tx,
        existing.id,
      );

      return createNextPolicyVersion(
        tx,
        existing,
        tenantId,
        now,
        existingBindings.map((binding) => ({
          tenant_id: binding.tenant_id,
          rule_id: binding.rule_id,
          enabled: binding.enabled,
          required: binding.required,
          order_index: binding.order_index,
        })),
        {
          name: body.name,
          description: body.description,
          category: body.category,
          status: body.status,
          enforcement_mode: body.enforcement_mode,
          priority: body.priority,
        },
      );
    });

    return c.json({ policy: updated });
  },
);

policyDetailRouter.delete("/v1/policies/:policy_id", async (c) => {
  const policyIdResult = validateUuidParam(c, "policy_id", "Policy ID");
  if (!policyIdResult.ok) return policyIdResult.response;
  const policyId = policyIdResult.value;
  const { tenantId } = getAuthContext(c);

  const existing = await loadPolicyForTenant(policyId, tenantId);
  if (!existing) {
    return errorJson(c, 404, "NOT_FOUND", "Policy not found", policyId);
  }
  const capabilityResult = requireTenantCapability(
      c,
      existing.scope === "project"
        ? "policy.write_project"
        : "policy.write_tenant",
      "You do not have access to delete this policy",
    );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(policies)
      .set({ effective_to: now, updated_at: now })
      .where(and(eq(policies.id, policyId), eq(policies.tenant_id, tenantId)));

    await tx
      .update(policy_project_bindings)
      .set({ effective_to: now, updated_at: now })
      .where(
        and(
          eq(policy_project_bindings.policy_key, existing.policy_key),
          eq(policy_project_bindings.tenant_id, tenantId),
        ),
      );
  });
  return c.body(null, 204);
});

policyDetailRouter.get(
  "/v1/policies/:policy_id/violations",
  zValidator("query", policyViolationsQuerySchema),
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
        policy.scope === "project"
          ? "policy.read_project"
          : "policy.read_tenant",
        "You do not have access to view policy violations",
      );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    const {
      rule_id: ruleId,
      status,
      since,
      limit,
      offset,
    } = c.req.valid("query");

    const conditions = [
      eq(violations.policy_id, policyId),
      eq(violations.tenant_id, tenantId),
    ];

    if (ruleId) conditions.push(eq(violations.rule_id, ruleId));
    if (status) conditions.push(eq(violations.status, status));
    if (since) conditions.push(gte(violations.last_seen_at, since));

    const rows = await db
      .select()
      .from(violations)
      .where(
        and(
          ...(conditions as [
            ReturnType<typeof eq>,
            ...ReturnType<typeof eq>[],
          ]),
        ),
      )
      .orderBy(desc(violations.last_seen_at))
      .limit(limit)
      .offset(offset);

    const enriched = await enrichViolations(rows);
    return c.json({ violations: enriched, limit, offset });
  },
);

policyDetailRouter.get(
  "/v1/policies/:policy_id/rule-violation-counts",
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
        policy.scope === "project"
          ? "policy.read_project"
          : "policy.read_tenant",
        "You do not have access to view policy violation counts",
      );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    const rows = await db.execute(sql`
    SELECT rule_id, COUNT(*) AS open_count
    FROM violations
    WHERE policy_id   = ${policyId}
      AND tenant_id   = ${tenantId}
      AND status      = 'open'
      AND last_seen_at >= now() - interval '30 days'
    GROUP BY rule_id
  `);

    const counts: Record<string, number> = {};
    for (const row of rows as unknown as Array<{
      rule_id: string;
      open_count: string;
    }>) {
      if (row.rule_id) counts[row.rule_id] = Number(row.open_count);
    }

    return c.json({ counts });
  },
);
