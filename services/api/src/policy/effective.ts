/**
 * Effective policy loader — loads and resolves the full policy snapshot for
 * a project from the database. Used by both the gateway (real Check requests)
 * and the preview endpoints (simulation).
 *
 * Resolution order:
 *   1. Global policies (scope='global', project_id IS NULL) for the tenant
 *   2. Project-scoped policies (scope='project', project_id = this project)
 *   3. Policy project bindings (global policies applied to this project with overrides)
 * Sorted by policy.priority ASC, then rule.order_index ASC within each policy.
 */

import { eq, and, gt, isNull, inArray, lte } from "drizzle-orm";
import {
  ENFORCEMENT_MODE,
  POLICY_SCOPE,
  POLICY_STATUS,
} from "@customs/shared-constants";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  policies,
  policy_project_bindings,
  policy_rule_bindings,
  rules,
  connector_snapshots,
} from "../db/schema.js";
import type { Condition } from "./expression.js";
import type { ConnectorSnapshot } from "../connectors/types.js";
import type { ArtifactIdentity } from "../features/packages/artifact-identity.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RuleAction {
  type: string; // 'violation' | 'warning' | 'info'
  severity?: string; // 'critical' | 'high' | 'medium' | 'low'
  code?: string;
  message_template?: string;
  recommended_remediation?: string;
  enforcement_mode?: string; // 'enforcing' | 'advisory'; defaults to policy's mode
}

type RuleOverride = {
  enabled?: boolean;
  condition?: {
    mode?: string;
    value?: unknown;
  };
  action?: {
    mode?: string;
    value?: Record<string, unknown>;
  };
};

export interface ResolvedRule {
  id: string;
  ruleKey: string;
  policyId: string;
  policyRuleBindingId: string;
  policyProjectBindingId: string | null;
  policyName: string;
  name: string;
  description?: string;
  targetEntity: string;
  condition: Condition;
  action: RuleAction;
  effectiveEnforcementMode: string; // after assignment override applied
  orderIndex: number;
  policyPriority: number;
}

export interface PolicySnapshot {
  resolvedAt: string;
  tenantId: string;
  projectId: string;
  policies: Array<{
    id: string;
    name: string;
    scope: string;
    enforcementMode: string;
    priority: number;
    source: "global" | "project" | "assigned";
    policyKey: string;
    policyProjectBindingId: string | null;
    overrideState: Record<string, unknown> | null;
    rules: ResolvedRule[];
  }>;
  allRules: ResolvedRule[]; // flattened, sorted by priority+order_index
}

// ---------------------------------------------------------------------------
// Load effective policy snapshot for a project
// ---------------------------------------------------------------------------

export async function loadEffectivePolicy(
  db: NodePgDatabase<any>,
  tenantId: string,
  projectId: string,
): Promise<PolicySnapshot> {
  const resolvedAt = new Date().toISOString();
  const effectiveAt = new Date(resolvedAt);

  // Load active project-scoped policies directly owned by this project.
  const projectPolicyRows = await db
    .select()
    .from(policies)
    .where(
      and(
        eq(policies.tenant_id, tenantId),
        eq(policies.status, POLICY_STATUS.ACTIVE),
        eq(policies.scope, POLICY_SCOPE.PROJECT),
        eq(policies.project_id, projectId),
        lte(policies.effective_from, effectiveAt),
        gt(policies.effective_to, effectiveAt),
      ),
    )
    .orderBy(policies.priority);

  // Load active tenant/global policies. These apply to every project by default.
  const globalPolicyRows = await db
    .select()
    .from(policies)
    .where(
      and(
        eq(policies.tenant_id, tenantId),
        eq(policies.status, POLICY_STATUS.ACTIVE),
        eq(policies.scope, POLICY_SCOPE.GLOBAL),
        isNull(policies.project_id),
        lte(policies.effective_from, effectiveAt),
        gt(policies.effective_to, effectiveAt),
      ),
    )
    .orderBy(policies.priority);

  // Load current project bindings. Bindings customize or disable inherited
  // global policies; absence of a binding does not opt the project out.
  const bindingRows = await db
    .select()
    .from(policy_project_bindings)
    .where(
      and(
        eq(policy_project_bindings.tenant_id, tenantId),
        eq(policy_project_bindings.project_id, projectId),
        lte(policy_project_bindings.effective_from, effectiveAt),
        gt(policy_project_bindings.effective_to, effectiveAt),
      ),
    );

  const bindingByPolicyKey = new Map(
    bindingRows.map((binding) => [binding.policy_key, binding]),
  );

  const effectivePolicies = [
    ...globalPolicyRows.flatMap((policy) => {
      const binding = bindingByPolicyKey.get(policy.policy_key) ?? null;
      if (
        binding &&
        (!binding.enabled || binding.inheritance_mode === "disabled")
      ) {
        return [];
      }
      return [
        {
          policy,
          source: binding ? ("assigned" as const) : ("global" as const),
          binding,
        },
      ];
    }),
    ...projectPolicyRows.map((policy) => ({
      policy,
      source: "project" as const,
      binding: null,
    })),
  ].sort((a, b) => a.policy.priority - b.policy.priority);

  const policyIds = effectivePolicies.map(({ policy }) => policy.id);
  if (policyIds.length === 0) {
    return {
      resolvedAt,
      tenantId,
      projectId,
      policies: [],
      allRules: [],
    };
  }

  const bindingRuleRows = await db
    .select({
      binding_id: policy_rule_bindings.id,
      policy_id: policy_rule_bindings.policy_id,
      enabled: policy_rule_bindings.enabled,
      order_index: policy_rule_bindings.order_index,
      rule: rules,
    })
    .from(policy_rule_bindings)
    .innerJoin(rules, eq(policy_rule_bindings.rule_id, rules.id))
    .where(
      and(
        inArray(policy_rule_bindings.policy_id, policyIds),
        eq(policy_rule_bindings.enabled, true),
        lte(rules.effective_from, effectiveAt),
        gt(rules.effective_to, effectiveAt),
      ),
    )
    .orderBy(policy_rule_bindings.order_index);

  const rulesByPolicyId = new Map<string, typeof bindingRuleRows>();
  for (const row of bindingRuleRows) {
    const list = rulesByPolicyId.get(row.policy_id) ?? [];
    list.push(row);
    rulesByPolicyId.set(row.policy_id, list);
  }

  const resolvedPolicies: PolicySnapshot["policies"] = [];
  const allRules: ResolvedRule[] = [];

  for (const { policy, source, binding } of effectivePolicies) {

    // Effective enforcement mode: assignment may soften (never harden)
    const effectivePolicyMode = resolveEnforcementMode(
      policy.enforcement_mode,
      binding?.enforcement_mode_override ?? null,
    );

    const policyRules = rulesByPolicyId.get(policy.id) ?? [];
    const resolved: ResolvedRule[] = policyRules.flatMap((row) => {
      const override = getRuleOverride(binding?.rule_overrides, row.rule.rule_key);
      if (override?.enabled === false) return [];

      const condition =
        override?.condition?.mode === "replace"
          ? (override.condition.value as Condition)
          : (row.rule.condition as Condition);
      const action =
        override?.action?.mode === "merge"
          ? ({
              ...(row.rule.action as RuleAction),
              ...override.action.value,
            } as RuleAction)
          : (row.rule.action as RuleAction);

      return [
        {
          id: row.rule.id,
          ruleKey: row.rule.rule_key,
          policyRuleBindingId: row.binding_id,
          policyProjectBindingId: binding?.id ?? null,
          policyId: policy.id,
          policyName: policy.name,
          name: row.rule.name,
          description: row.rule.description ?? undefined,
          targetEntity: row.rule.target_entity,
          condition,
          action,
          effectiveEnforcementMode: resolveEnforcementMode(
            action.enforcement_mode ?? policy.enforcement_mode,
            binding?.enforcement_mode_override ?? null,
          ),
          orderIndex: row.order_index,
          policyPriority: policy.priority,
        },
      ];
    });

    resolvedPolicies.push({
      id: policy.id,
      policyKey: policy.policy_key,
      name: policy.name,
      scope: policy.scope,
      enforcementMode: effectivePolicyMode,
      priority: policy.priority,
      source,
      policyProjectBindingId: binding?.id ?? null,
      overrideState: binding
        ? {
            inheritanceMode: binding.inheritance_mode,
            severityOverride: binding.severity_override,
            thresholdOverrides: binding.threshold_overrides,
            ruleOverrides: binding.rule_overrides,
            enforcementModeOverride: binding.enforcement_mode_override,
          }
        : null,
      rules: resolved,
    });

    allRules.push(...resolved);
  }

  // Sort flat rule list by (policyPriority ASC, orderIndex ASC)
  allRules.sort((a, b) =>
    a.policyPriority !== b.policyPriority
      ? a.policyPriority - b.policyPriority
      : a.orderIndex - b.orderIndex,
  );

  return {
    resolvedAt,
    tenantId,
    projectId,
    policies: resolvedPolicies,
    allRules,
  };
}

// ---------------------------------------------------------------------------
// Connector snapshot upsert — writes snapshot to DB before evaluation
// ---------------------------------------------------------------------------

export async function upsertConnectorSnapshot(
  db: NodePgDatabase<any>,
  tenantId: string,
  projectId: string,
  snapshot: ConnectorSnapshot,
): Promise<void> {
  await db
    .insert(connector_snapshots)
    .values({
      tenant_id: tenantId,
      project_id: projectId,
      connector_key: snapshot.connectorKey,
      entity_type: snapshot.entityType,
      package_id: snapshot.packageId,
      package_version_id: snapshot.packageVersionId,
      fields: snapshot.fields,
      meta: snapshot.meta,
      observed_at: new Date(snapshot.observedAt),
    })
    .onConflictDoUpdate({
      target: [
        connector_snapshots.project_id,
        connector_snapshots.connector_key,
        connector_snapshots.entity_type,
        connector_snapshots.package_id,
        connector_snapshots.package_version_id,
      ],
      set: {
        fields: snapshot.fields,
        meta: snapshot.meta,
        package_id: snapshot.packageId,
        package_version_id: snapshot.packageVersionId,
        observed_at: new Date(snapshot.observedAt),
      },
    });
}

// ---------------------------------------------------------------------------
// Load latest snapshots for an entity
// ---------------------------------------------------------------------------

export async function loadSnapshots(
  db: NodePgDatabase<any>,
  projectId: string,
  artifactIdentity: ArtifactIdentity,
  entityType: string,
): Promise<ConnectorSnapshot[]> {
  if (!artifactIdentity.package_id) return [];

  const rows = await db
    .select()
    .from(connector_snapshots)
    .where(
      and(
        eq(connector_snapshots.project_id, projectId),
        artifactIdentity.package_version_id
          ? eq(
              connector_snapshots.package_version_id,
              artifactIdentity.package_version_id,
            )
          : eq(connector_snapshots.package_id, artifactIdentity.package_id),
        eq(connector_snapshots.entity_type, entityType),
      ),
    );

  return rows.map((r) => ({
    connectorKey: r.connector_key,
    entityType: r.entity_type,
    packageId: artifactIdentity.package_id,
    packageVersionId: artifactIdentity.package_version_id,
    ecosystem: artifactIdentity.ecosystem,
    packageName: artifactIdentity.package,
    version: artifactIdentity.version,
    displayName: artifactIdentity.display_name,
    fields: (r.fields as Record<string, unknown>) ?? {},
    meta: r.meta as ConnectorSnapshot["meta"],
    observedAt: r.observed_at.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve effective enforcement mode — an assignment may soften (enforcing→advisory)
 * but never harden (advisory→enforcing).
 */
function resolveEnforcementMode(base: string, override: string | null): string {
  if (!override) return base;
  // Softening: enforcing → advisory is allowed
  if (
    base === ENFORCEMENT_MODE.ENFORCING &&
    override === ENFORCEMENT_MODE.ADVISORY
  ) {
    return ENFORCEMENT_MODE.ADVISORY;
  }
  // disabled always wins
  if (override === ENFORCEMENT_MODE.DISABLED) {
    return ENFORCEMENT_MODE.DISABLED;
  }
  return base;
}

function getRuleOverride(
  ruleOverrides: unknown,
  ruleKey: string,
): RuleOverride | null {
  if (!ruleOverrides || typeof ruleOverrides !== "object") return null;
  const overrides = ruleOverrides as Record<string, unknown>;
  const value = overrides[ruleKey];
  if (!value || typeof value !== "object") return null;
  return value as RuleOverride;
}
