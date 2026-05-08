/**
 * Effective policy loader — loads and resolves the full policy snapshot for
 * a project from the database. Used by both the gateway (real Check requests)
 * and the preview endpoints (simulation).
 *
 * Resolution order:
 *   1. Global policies (scope='global', project_id IS NULL) for the tenant
 *   2. Project-scoped policies (scope='project', project_id = this project)
 *   3. Policy assignments (global policies assigned to this project with overrides)
 * Sorted by policy.priority ASC, then rule.order_index ASC within each policy.
 */

import { eq, and, or, isNull, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  policies,
  rules,
  policy_assignments,
  connector_snapshots,
} from "../db/schema.js";
import type { Condition } from "./expression.js";
import type { ConnectorSnapshot } from "../connectors/types.js";
import {
  resolveArtifactIdentity,
  type ArtifactIdentity,
} from "../features/packages/artifact-identity.js";
import { parsePackageEntityId } from "../features/packages/identity.js";

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

export interface ResolvedRule {
  id: string;
  policyId: string;
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
  // Load all active policies for this tenant (global + project-scoped for this project)
  const policyRows = await db
    .select()
    .from(policies)
    .where(
      and(
        eq(policies.tenant_id, tenantId),
        eq(policies.status, "active"),
        or(
          and(eq(policies.scope, "global"), isNull(policies.project_id)),
          and(
            eq(policies.scope, "project"),
            eq(policies.project_id, projectId),
          ),
        ),
      ),
    )
    .orderBy(policies.priority);

  const policyIds = policyRows.map((p) => p.id);
  if (policyIds.length === 0) {
    return {
      resolvedAt: new Date().toISOString(),
      tenantId,
      projectId,
      policies: [],
      allRules: [],
    };
  }

  // Load all rules for these policies in one query
  const ruleRows = await db
    .select()
    .from(rules)
    .where(and(inArray(rules.policy_id, policyIds), eq(rules.enabled, true)))
    .orderBy(rules.order_index);

  // Load policy assignments for this project (global → project links with overrides)
  const assignmentRows = await db
    .select()
    .from(policy_assignments)
    .where(
      and(
        eq(policy_assignments.project_id, projectId),
        eq(policy_assignments.enabled, true),
      ),
    );

  const assignmentByPolicyId = new Map(
    assignmentRows.map((a) => [a.policy_id, a]),
  );

  // Group rules by policy
  const rulesByPolicyId = new Map<string, typeof ruleRows>();
  for (const rule of ruleRows) {
    const list = rulesByPolicyId.get(rule.policy_id) ?? [];
    list.push(rule);
    rulesByPolicyId.set(rule.policy_id, list);
  }

  const resolvedPolicies: PolicySnapshot["policies"] = [];
  const allRules: ResolvedRule[] = [];

  for (const policy of policyRows) {
    const assignment = assignmentByPolicyId.get(policy.id);

    // Skip disabled assignments (already filtered by enabled=true above,
    // but if a global policy has an assignment with enabled=false it won't appear)
    const source: "global" | "project" | "assigned" =
      policy.scope === "project"
        ? "project"
        : assignment
          ? "assigned"
          : "global";

    // Effective enforcement mode: assignment may soften (never harden)
    const effectivePolicyMode = resolveEnforcementMode(
      policy.enforcement_mode,
      assignment?.enforcement_mode_override ?? null,
    );

    const policyRules = rulesByPolicyId.get(policy.id) ?? [];
    const resolved: ResolvedRule[] = policyRules.map((rule) => ({
      id: rule.id,
      policyId: policy.id,
      policyName: policy.name,
      name: rule.name,
      description: rule.description ?? undefined,
      targetEntity: rule.target_entity,
      condition: rule.condition as Condition,
      action: rule.action as RuleAction,
      effectiveEnforcementMode: resolveEnforcementMode(
        // Rule action may override enforcement_mode; falls back to raw policy mode
        // (use policy.enforcement_mode, not effectivePolicyMode, so the assignment
        // override is applied exactly once at this level, not twice)
        (rule.action as RuleAction).enforcement_mode ?? policy.enforcement_mode,
        assignment?.enforcement_mode_override ?? null,
      ),
      orderIndex: rule.order_index,
      policyPriority: policy.priority,
    }));

    resolvedPolicies.push({
      id: policy.id,
      name: policy.name,
      scope: policy.scope,
      enforcementMode: effectivePolicyMode,
      priority: policy.priority,
      source,
      overrideState: assignment
        ? {
            inheritanceMode: assignment.inheritance_mode,
            severityOverride: assignment.severity_override,
            thresholdOverrides: assignment.threshold_overrides,
            enforcementModeOverride: assignment.enforcement_mode_override,
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
    resolvedAt: new Date().toISOString(),
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
  const artifactIdentity = await resolveSnapshotArtifactIdentity(db, snapshot);

  await db
    .insert(connector_snapshots)
    .values({
      tenant_id: tenantId,
      project_id: projectId,
      connector_key: snapshot.connectorKey,
      entity_type: snapshot.entityType,
      package_id: artifactIdentity?.package_id ?? null,
      package_version_id: artifactIdentity?.package_version_id ?? null,
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
        package_id: artifactIdentity?.package_id ?? null,
        package_version_id: artifactIdentity?.package_version_id ?? null,
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
    entityId: artifactIdentity.canonical_ref,
    fields: (r.fields as Record<string, unknown>) ?? {},
    meta: r.meta as ConnectorSnapshot["meta"],
    observedAt: r.observed_at.toISOString(),
  }));
}

async function resolveSnapshotArtifactIdentity(
  db: NodePgDatabase<any>,
  snapshot: ConnectorSnapshot,
): Promise<ArtifactIdentity | null> {
  if (snapshot.entityType !== "artifact" && snapshot.entityType !== "package") {
    return null;
  }

  const identity = parsePackageEntityId(snapshot.entityId);
  if (!identity) return null;

  return resolveArtifactIdentity(db, {
    ...identity,
    version: snapshot.entityType === "artifact" ? identity.version : null,
    source: "connector_snapshot",
  });
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
  if (base === "enforcing" && override === "advisory") return "advisory";
  // disabled always wins
  if (override === "disabled") return "disabled";
  return base;
}
