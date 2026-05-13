import { and, asc, eq } from "drizzle-orm";
import { policies, policy_rule_bindings } from "../../db/schema.js";

type Tx = any;

export type PolicyRow = typeof policies.$inferSelect;
export type PolicyRuleBindingRow = typeof policy_rule_bindings.$inferSelect;

export type PolicyRuleBindingClone = {
  tenant_id: string;
  rule_id: string;
  enabled: boolean;
  required: boolean;
  order_index: number;
};

export async function loadPolicyRuleBindingsForClone(
  tx: Tx,
  policyId: string,
): Promise<PolicyRuleBindingRow[]> {
  const rows = (await tx
    .select()
    .from(policy_rule_bindings)
    .where(eq(policy_rule_bindings.policy_id, policyId))
    .orderBy(asc(policy_rule_bindings.order_index))) as PolicyRuleBindingRow[];

  return rows;
}

export async function createNextPolicyVersion(
  tx: Tx,
  existing: PolicyRow,
  tenantId: string,
  now: Date,
  bindings: PolicyRuleBindingClone[],
  patch: Partial<
    Pick<
      PolicyRow,
      | "name"
      | "description"
      | "category"
      | "status"
      | "enforcement_mode"
      | "priority"
    >
  > = {},
): Promise<PolicyRow> {
  const [newPolicy] = (await tx
    .insert(policies)
    .values({
      tenant_id: existing.tenant_id,
      project_id: existing.project_id,
      policy_key: existing.policy_key,
      name: patch.name ?? existing.name,
      description:
        patch.description === undefined
          ? existing.description
          : patch.description,
      category: patch.category === undefined ? existing.category : patch.category,
      scope: existing.scope,
      status: patch.status ?? existing.status,
      enforcement_mode: patch.enforcement_mode ?? existing.enforcement_mode,
      priority: patch.priority ?? existing.priority,
      version: existing.version + 1,
      effective_from: now,
      created_by: existing.created_by,
    })
    .returning()) as PolicyRow[];
  if (!newPolicy) throw new Error("policy_version_create_failed");

  if (bindings.length > 0) {
    await tx.insert(policy_rule_bindings).values(
      bindings.map((binding) => ({
        tenant_id: binding.tenant_id,
        policy_id: newPolicy.id,
        rule_id: binding.rule_id,
        enabled: binding.enabled,
        required: binding.required,
        order_index: binding.order_index,
      })),
    );
  }

  await tx
    .update(policies)
    .set({
      effective_to: now,
      superseded_by_id: newPolicy.id,
      updated_at: now,
    })
    .where(and(eq(policies.id, existing.id), eq(policies.tenant_id, tenantId)));

  return newPolicy;
}
