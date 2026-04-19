import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { policies, policy_assignments, projects } from "../../db/schema.js";
import { getAuthContext, requireTenantCapability } from "../../http/guards.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";
import { createAssignmentSchema } from "./shared.js";

export const policyAssignmentsPolicyRouter = new Hono();

async function loadGlobalPolicyForTenant(policyId: string, tenantId: string) {
  const [policy] = await db
    .select({ id: policies.id, scope: policies.scope })
    .from(policies)
    .where(and(eq(policies.id, policyId), eq(policies.tenant_id, tenantId)))
    .limit(1);

  return policy;
}

policyAssignmentsPolicyRouter.get(
  "/v1/policies/:policy_id/assignments",
  async (c) => {
    const policyId = validateUuidParam(c, "policy_id", "Policy ID");
    if (!policyId) return c.res;

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
        "Only global policies can have assignments",
      );
    }
    if (
      !requireTenantCapability(
        c,
        "policy_assignments.read",
        "You do not have access to view policy assignments",
      )
    ) {
      return c.res;
    }

    const rows = await db
      .select()
      .from(policy_assignments)
      .where(eq(policy_assignments.policy_id, policyId));

    return c.json({ assignments: rows });
  },
);

policyAssignmentsPolicyRouter.post(
  "/v1/policies/:policy_id/assignments",
  zValidator("json", createAssignmentSchema),
  async (c) => {
    const policyId = validateUuidParam(c, "policy_id", "Policy ID");
    if (!policyId) return c.res;

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
        "Only global policies can have assignments",
      );
    }
    if (
      !requireTenantCapability(
        c,
        "policy_assignments.write",
        "You do not have access to create policy assignments",
      )
    ) {
      return c.res;
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
      .insert(policy_assignments)
      .values({
        policy_id: policyId,
        project_id: body.project_id,
        tenant_id: tenantId,
        enabled: body.enabled ?? true,
        inheritance_mode: body.inheritance_mode ?? "inherited",
        severity_override: body.severity_override ?? null,
        threshold_overrides: body.threshold_overrides ?? null,
        enforcement_mode_override: body.enforcement_mode_override ?? null,
      })
      .returning();

    return c.json({ assignment: created }, 201);
  },
);
