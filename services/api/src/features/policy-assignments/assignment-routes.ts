import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { policy_project_bindings } from "../../db/schema.js";
import { getAuthContext, requireTenantCapability } from "../../http/guards.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";
import { bindingMutationSchema } from "./shared.js";

export const policyBindingDetailRouter = new Hono();

async function loadBindingForTenant(bindingId: string, tenantId: string) {
  const [binding] = await db
    .select()
    .from(policy_project_bindings)
    .where(
      and(
        eq(policy_project_bindings.id, bindingId),
        eq(policy_project_bindings.tenant_id, tenantId),
      ),
    )
    .limit(1);

  return binding;
}

policyBindingDetailRouter.get(
  "/v1/policy-bindings/:binding_id",
  async (c) => {
    const bindingIdResult = validateUuidParam(c, "binding_id", "Binding ID");
    if (!bindingIdResult.ok) return bindingIdResult.response;
    const bindingId = bindingIdResult.value;

    const { tenantId } = getAuthContext(c);
    const binding = await loadBindingForTenant(bindingId, tenantId);
    if (!binding) {
      return errorJson(
        c,
        404,
        "NOT_FOUND",
        "Binding not found",
        bindingId,
      );
    }
    const capabilityResult = requireTenantCapability(
        c,
        "policy_assignments.read",
        "You do not have access to view this binding",
      );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    return c.json({ binding });
  },
);

policyBindingDetailRouter.patch(
  "/v1/policy-bindings/:binding_id",
  zValidator("json", bindingMutationSchema),
  async (c) => {
    const bindingIdResult = validateUuidParam(c, "binding_id", "Binding ID");
    if (!bindingIdResult.ok) return bindingIdResult.response;
    const bindingId = bindingIdResult.value;

    const capabilityResult = requireTenantCapability(
        c,
        "policy_assignments.write",
        "You do not have access to modify policy bindings",
      );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    const { tenantId } = getAuthContext(c);
    const existing = await loadBindingForTenant(bindingId, tenantId);
    if (!existing) {
      return errorJson(
        c,
        404,
        "NOT_FOUND",
        "Binding not found",
        bindingId,
      );
    }

    const body = c.req.valid("json");
    const updated = await db.transaction(async (tx) => {
      const now = new Date();
      const [nextBinding] = await tx
        .insert(policy_project_bindings)
        .values({
          binding_key: existing.binding_key,
          policy_key: existing.policy_key,
          project_id: existing.project_id,
          tenant_id: existing.tenant_id,
          enabled: body.enabled ?? existing.enabled,
          inheritance_mode:
            body.inheritance_mode ?? existing.inheritance_mode,
          severity_override:
            body.severity_override === undefined
              ? existing.severity_override
              : body.severity_override,
          threshold_overrides:
            body.threshold_overrides === undefined
              ? existing.threshold_overrides
              : body.threshold_overrides,
          rule_overrides:
            body.rule_overrides === undefined
              ? existing.rule_overrides
              : body.rule_overrides,
          enforcement_mode_override:
            body.enforcement_mode_override === undefined
              ? existing.enforcement_mode_override
              : body.enforcement_mode_override,
          version: existing.version + 1,
          effective_from: now,
        })
        .returning();
      if (!nextBinding) throw new Error("binding_version_create_failed");

      await tx
        .update(policy_project_bindings)
        .set({
          effective_to: now,
          superseded_by_id: nextBinding.id,
          updated_at: now,
        })
        .where(
          and(
            eq(policy_project_bindings.id, bindingId),
            eq(policy_project_bindings.tenant_id, tenantId),
          ),
        );

      return nextBinding;
    });

    return c.json({ binding: updated });
  },
);

policyBindingDetailRouter.delete(
  "/v1/policy-bindings/:binding_id",
  async (c) => {
    const bindingIdResult = validateUuidParam(c, "binding_id", "Binding ID");
    if (!bindingIdResult.ok) return bindingIdResult.response;
    const bindingId = bindingIdResult.value;

    const capabilityResult = requireTenantCapability(
        c,
        "policy_assignments.write",
        "You do not have access to delete policy bindings",
      );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    const { tenantId } = getAuthContext(c);
    const existing = await loadBindingForTenant(bindingId, tenantId);
    if (!existing) {
      return errorJson(
        c,
        404,
        "NOT_FOUND",
        "Binding not found",
        bindingId,
      );
    }

    const now = new Date();
    await db
      .update(policy_project_bindings)
      .set({ effective_to: now, updated_at: now })
      .where(
        and(
          eq(policy_project_bindings.id, bindingId),
          eq(policy_project_bindings.tenant_id, tenantId),
        ),
      );

    return c.body(null, 204);
  },
);
