import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq, gt, lte } from "drizzle-orm";
import { db } from "../../db/index.js";
import { policies, policy_project_bindings, projects } from "../../db/schema.js";
import { getAuthContext, requireTenantCapability } from "../../http/guards.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";
import { createBindingSchema } from "./shared.js";

export const policyBindingsPolicyRouter = new Hono();

async function loadGlobalPolicyForTenant(policyId: string, tenantId: string) {
  const [policy] = await db
    .select({ id: policies.id, policy_key: policies.policy_key, scope: policies.scope })
    .from(policies)
    .where(and(eq(policies.id, policyId), eq(policies.tenant_id, tenantId)))
    .limit(1);

  return policy;
}

policyBindingsPolicyRouter.get(
  "/v1/policies/:policy_id/bindings",
  async (c) => {
    const policyIdResult = validateUuidParam(c, "policy_id", "Policy ID");
    if (!policyIdResult.ok) return policyIdResult.response;
    const policyId = policyIdResult.value;

    const { tenantId } = getAuthContext(c);
    const policy = await loadGlobalPolicyForTenant(policyId, tenantId);
    if (!policy) {
      return errorJson(c, 404, "NOT_FOUND", "Policy not found", policyId);
    }
    if (policy.scope !== "global") {
      return errorJson(
        c,
        400,
        "INVALID_REQUEST",
        "Only global policies can have bindings",
      );
    }
    const capabilityResult = requireTenantCapability(
        c,
        "policy_assignments.read",
        "You do not have access to view policy bindings",
      );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    const now = new Date();
    const rows = await db
      .select()
      .from(policy_project_bindings)
      .where(
        and(
          eq(policy_project_bindings.policy_key, policy.policy_key),
          lte(policy_project_bindings.effective_from, now),
          gt(policy_project_bindings.effective_to, now),
        ),
      );

    return c.json({ bindings: rows });
  },
);

policyBindingsPolicyRouter.post(
  "/v1/policies/:policy_id/bindings",
  zValidator("json", createBindingSchema),
  async (c) => {
    const policyIdResult = validateUuidParam(c, "policy_id", "Policy ID");
    if (!policyIdResult.ok) return policyIdResult.response;
    const policyId = policyIdResult.value;

    const { tenantId } = getAuthContext(c);
    const policy = await loadGlobalPolicyForTenant(policyId, tenantId);
    if (!policy) {
      return errorJson(c, 404, "NOT_FOUND", "Policy not found", policyId);
    }
    if (policy.scope !== "global") {
      return errorJson(
        c,
        400,
        "INVALID_REQUEST",
        "Only global policies can have bindings",
      );
    }
    const capabilityResult = requireTenantCapability(
        c,
        "policy_assignments.write",
        "You do not have access to create policy bindings",
      );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    const body = c.req.valid("json");
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(eq(projects.id, body.project_id), eq(projects.tenant_id, tenantId)),
      )
      .limit(1);

    if (!project) {
      return errorJson(
        c,
        404,
        "NOT_FOUND",
        "Project not found",
        body.project_id,
      );
    }

    const [created] = await db
      .insert(policy_project_bindings)
      .values({
        policy_key: policy.policy_key,
        project_id: body.project_id,
        tenant_id: tenantId,
        enabled: body.enabled ?? true,
        inheritance_mode: body.inheritance_mode ?? "inherited",
        severity_override: body.severity_override ?? null,
        threshold_overrides: body.threshold_overrides ?? null,
        rule_overrides: body.rule_overrides ?? null,
        enforcement_mode_override: body.enforcement_mode_override ?? null,
      })
      .returning();

    return c.json({ binding: created }, 201);
  },
);
