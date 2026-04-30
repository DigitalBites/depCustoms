import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gte, ilike, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { policies, rules, violations } from "../../db/schema.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";
import { getAuthContext, requireTenantCapability } from "../../http/guards.js";
import { enrichViolations } from "../../routes/violations.js";
import {
  loadPolicyForTenant,
  patchPolicySchema,
  policyViolationsQuerySchema,
} from "./shared.js";

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
    .select()
    .from(rules)
    .where(eq(rules.policy_id, policyId))
    .orderBy(asc(rules.order_index));

  return c.json({ policy: { ...policy, rules: policyRules } });
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
    if (existing.status === "archived") {
      return errorJson(
        c,
        409,
        "INVALID_STATE",
        "Archived policies cannot be modified",
      );
    }

    const body = c.req.valid("json");
    const [updated] = await db
      .update(policies)
      .set({ ...body, updated_at: new Date() })
      .where(and(eq(policies.id, policyId), eq(policies.tenant_id, tenantId)))
      .returning();

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
  if (existing.status !== "draft") {
    return errorJson(
      c,
      409,
      "INVALID_STATE",
      "Only draft policies may be deleted. Use PATCH status=archived for active policies.",
    );
  }

  await db
    .delete(policies)
    .where(and(eq(policies.id, policyId), eq(policies.tenant_id, tenantId)));
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
      search,
      limit,
      offset,
    } = c.req.valid("query");

    const conditions = [
      eq(violations.policy_id, policyId),
      eq(violations.tenant_id, tenantId),
    ];

    if (ruleId) conditions.push(eq(violations.rule_id, ruleId));
    if (status) conditions.push(eq(violations.status, status));
    if (since) conditions.push(gte(violations.evaluated_at, since));
    if (search) conditions.push(ilike(violations.entity_id, `%${search}%`));

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
      .orderBy(desc(violations.evaluated_at))
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
      AND evaluated_at >= now() - interval '30 days'
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
