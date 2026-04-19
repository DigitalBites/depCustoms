import { db } from "../../../db/index.js";
import { loadEffectivePolicy } from "../../../policy/effective.js";
import type { McpRequestContext } from "../context.js";
import { requireMcpProjectAccess } from "./project-access.js";

export async function getEffectivePoliciesForMcp(
  ctx: McpRequestContext,
  projectId: string,
) {
  await requireMcpProjectAccess(ctx.principal, projectId);

  const snapshot = await loadEffectivePolicy(
    db as any,
    ctx.principal.tenantId,
    projectId,
  );

  return {
    tenant_id: snapshot.tenantId,
    project_id: snapshot.projectId,
    resolved_at: snapshot.resolvedAt,
    policies: snapshot.policies.map((policy) => ({
      id: policy.id,
      name: policy.name,
      scope: policy.scope,
      source: policy.source,
      enforcement_mode: policy.enforcementMode,
      priority: policy.priority,
      inherited: policy.source !== "project",
      override_state: policy.overrideState,
      rules: policy.rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        description: rule.description ?? null,
        target_entity: rule.targetEntity,
        effective_enforcement_mode: rule.effectiveEnforcementMode,
        action: rule.action,
        order_index: rule.orderIndex,
      })),
    })),
  };
}
