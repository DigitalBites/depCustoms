import { and, asc, eq, gt, isNull, lte } from "drizzle-orm";
import {
  ENFORCEMENT_MODE,
  POLICY_SCOPE,
  POLICY_STATUS,
  RULE_TARGET_ENTITY,
  SERVE_MODE,
  TENANT_KIND,
} from "@customs/shared-constants";
import type { db } from "../db/index.js";
import {
  policies,
  policy_rule_bindings,
  rules,
  tenant_entitlements,
  tenants,
} from "../db/schema.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type TenantPolicyProvisionSource =
  | "platform_template"
  | "builtin_starter";

export type TenantPolicyProvisionResult = {
  source: TenantPolicyProvisionSource;
  policiesCreated: number;
};

type StarterPolicyDefinition = {
  name: string;
  description: string;
  category: string;
  priority: number;
  rules: Array<{
    name: string;
    description: string;
    condition: Record<string, unknown>;
    action: Record<string, unknown>;
  }>;
};

export const DEFAULT_VERSION_COOLING_PERIOD_DAYS = 7;

const STARTER_POLICY_DEFINITIONS: StarterPolicyDefinition[] = [
  {
    name: "Default Security Policy",
    description:
      "Blocks newly published package versions, packages with critical or high CVEs detected by OSV, and demonstrates fail-closed handling when OSV data is unavailable",
    category: "vulnerability-management",
    priority: 100,
    rules: [
      {
        name: "Block Newly Released Package Versions",
        description:
          "Blocks package versions during the default release cooling period so freshly published packages have time to accumulate ecosystem signals",
        condition: {
          field: "asset.version_age_days",
          operator: "lt",
          value: DEFAULT_VERSION_COOLING_PERIOD_DAYS,
        },
        action: {
          type: "violation",
          severity: "high",
          code: "PACKAGE_VERSION_COOLING_PERIOD",
          enforcement_mode: "enforcing",
          message_template: `Package version is {{asset.version_age_days}} day(s) old; required cooling period is ${DEFAULT_VERSION_COOLING_PERIOD_DAYS} days`,
          recommended_remediation:
            `Wait until this package version is at least ${DEFAULT_VERSION_COOLING_PERIOD_DAYS} days old, or review and adjust the tenant policy if this release is trusted`,
        },
      },
      {
        name: "Block When OSV Data Unavailable",
        description:
          "Blocks packages when the OSV connector times out or is otherwise unavailable so missing vulnerability data does not silently allow a package",
        condition: {
          field: "source.osv._meta.status",
          operator: "in",
          value: ["background_pending", "unavailable", "error"],
        },
        action: {
          type: "violation",
          severity: "high",
          code: "OSV_DATA_UNAVAILABLE",
          enforcement_mode: "enforcing",
          message_template:
            "OSV vulnerability data unavailable (status: {{source.osv._meta.status}})",
        },
      },
      {
        name: "Block Critical CVEs",
        description:
          "Blocks any package with one or more critical-severity CVEs",
        condition: {
          field: "source.osv.critical_count",
          operator: "gt",
          value: 0,
        },
        action: {
          type: "violation",
          severity: "critical",
          code: "OSV_CRITICAL_CVE",
          enforcement_mode: "enforcing",
          message_template:
            "Package has {{source.osv.critical_count}} critical CVE(s)",
        },
      },
      {
        name: "Block High CVEs",
        description: "Blocks any package with one or more high-severity CVEs",
        condition: {
          field: "source.osv.high_count",
          operator: "gt",
          value: 0,
        },
        action: {
          type: "violation",
          severity: "high",
          code: "OSV_HIGH_CVE",
          enforcement_mode: "enforcing",
          message_template: "Package has {{source.osv.high_count}} high CVE(s)",
        },
      },
    ],
  },
  {
    name: "Contributor Risk Policy",
    description:
      "Blocks packages with elevated contributor risk scores (new maintainer, fresh account, high velocity)",
    category: "supply-chain",
    priority: 110,
    rules: [
      {
        name: "Block High Contributor Risk",
        description:
          "Blocks packages with contributor risk score >= 80 (new actor, fresh account, or high release velocity)",
        condition: {
          field: "source.contributor.contributor_risk_score",
          operator: "gte",
          value: 80,
        },
        action: {
          type: "violation",
          severity: "high",
          code: "CONTRIBUTOR_RISK_HIGH",
          enforcement_mode: "enforcing",
          message_template:
            "Package has contributor risk score {{source.contributor.contributor_risk_score}} (threshold: 80)",
          recommended_remediation:
            "Review the package maintainer history and recent releases before upgrading",
        },
      },
    ],
  },
];

export async function findPlatformTenantId(tx: Tx): Promise<string | null> {
  const [platformTenant] = await tx
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.kind, TENANT_KIND.PLATFORM))
    .orderBy(tenants.created_at)
    .limit(1);

  return platformTenant?.id ?? null;
}

export async function ensureTenantEntitlements(
  tx: Tx,
  tenantId: string,
): Promise<void> {
  const [existing] = await tx
    .select({ id: tenant_entitlements.id })
    .from(tenant_entitlements)
    .where(eq(tenant_entitlements.tenant_id, tenantId))
    .limit(1);

  if (existing) {
    return;
  }

  await tx.insert(tenant_entitlements).values({
    tenant_id: tenantId,
    allowed_ecosystems: null,
    serve_mode: SERVE_MODE.REDIRECT,
    cache_ttl_seconds: 300,
    mcp_enabled: true,
  });
}

export async function ensureStarterPolicies(
  tx: Tx,
  tenantId: string,
): Promise<number> {
  let created = 0;
  for (const definition of STARTER_POLICY_DEFINITIONS) {
    created += await ensureStarterPolicy(tx, tenantId, definition);
  }
  return created;
}

export async function provisionCustomerTenantDefaults(
  tx: Tx,
  input: {
    tenantId: string;
    platformTenantId?: string | null;
  },
): Promise<TenantPolicyProvisionResult> {
  await ensureTenantEntitlements(tx, input.tenantId);

  const platformTenantId =
    input.platformTenantId ?? (await findPlatformTenantId(tx));
  if (platformTenantId) {
    const copied = await copyPlatformPolicyTemplatesToTenant(tx, {
      platformTenantId,
      targetTenantId: input.tenantId,
    });
    if (copied > 0) {
      return { source: "platform_template", policiesCreated: copied };
    }
  }

  return {
    source: "builtin_starter",
    policiesCreated: await ensureStarterPolicies(tx, input.tenantId),
  };
}

async function ensureStarterPolicy(
  tx: Tx,
  tenantId: string,
  input: StarterPolicyDefinition,
): Promise<number> {
  const [existing] = await tx
    .select({ id: policies.id })
    .from(policies)
    .where(
      and(
        eq(policies.tenant_id, tenantId),
        isNull(policies.project_id),
        eq(policies.name, input.name),
      ),
    )
    .limit(1);

  if (existing) {
    return 0;
  }

  const [policy] = await tx
    .insert(policies)
    .values({
      tenant_id: tenantId,
      project_id: null,
      name: input.name,
      description: input.description,
      category: input.category,
      scope: POLICY_SCOPE.GLOBAL,
      status: POLICY_STATUS.ACTIVE,
      enforcement_mode: ENFORCEMENT_MODE.ENFORCING,
      priority: input.priority,
      created_by_user_id: null,
    })
    .returning({ id: policies.id });

  const createdRules = await tx
    .insert(rules)
    .values(
      input.rules.map((rule) => ({
        tenant_id: tenantId,
        name: rule.name,
        description: rule.description,
        target_entity: RULE_TARGET_ENTITY.ARTIFACT,
        condition: rule.condition,
        action: rule.action,
      })),
    )
    .returning({ id: rules.id });

  await tx.insert(policy_rule_bindings).values(
    createdRules.map((rule, index) => ({
      tenant_id: tenantId,
      policy_id: policy.id,
      rule_id: rule.id,
      enabled: true,
      order_index: index,
    })),
  );

  return 1;
}

async function copyPlatformPolicyTemplatesToTenant(
  tx: Tx,
  input: {
    platformTenantId: string;
    targetTenantId: string;
  },
): Promise<number> {
  if (input.platformTenantId === input.targetTenantId) {
    return 0;
  }

  const now = new Date();
  const templatePolicies = await tx
    .select()
    .from(policies)
    .where(
      and(
        eq(policies.tenant_id, input.platformTenantId),
        isNull(policies.project_id),
        eq(policies.scope, POLICY_SCOPE.GLOBAL),
        eq(policies.status, POLICY_STATUS.ACTIVE),
        lte(policies.effective_from, now),
        gt(policies.effective_to, now),
      ),
    )
    .orderBy(asc(policies.priority));

  let copied = 0;
  for (const templatePolicy of templatePolicies) {
    const [existingPolicy] = await tx
      .select({ id: policies.id })
      .from(policies)
      .where(
        and(
          eq(policies.tenant_id, input.targetTenantId),
          isNull(policies.project_id),
          eq(policies.name, templatePolicy.name),
        ),
      )
      .limit(1);
    if (existingPolicy) {
      continue;
    }

    const [createdPolicy] = await tx
      .insert(policies)
      .values({
        tenant_id: input.targetTenantId,
        project_id: null,
        name: templatePolicy.name,
        description: templatePolicy.description,
        category: templatePolicy.category,
        scope: POLICY_SCOPE.GLOBAL,
        status: templatePolicy.status,
        enforcement_mode: templatePolicy.enforcement_mode,
        priority: templatePolicy.priority,
        created_by_user_id: null,
      })
      .returning({ id: policies.id });

    const templateRules = await tx
      .select({
        binding: policy_rule_bindings,
        rule: rules,
      })
      .from(policy_rule_bindings)
      .innerJoin(rules, eq(policy_rule_bindings.rule_id, rules.id))
      .where(
        and(
          eq(policy_rule_bindings.tenant_id, input.platformTenantId),
          eq(policy_rule_bindings.policy_id, templatePolicy.id),
          eq(rules.tenant_id, input.platformTenantId),
        ),
      )
      .orderBy(asc(policy_rule_bindings.order_index));

    if (templateRules.length > 0) {
      const createdRules = await tx
        .insert(rules)
        .values(
          templateRules.map(({ rule }) => ({
            tenant_id: input.targetTenantId,
            name: rule.name,
            description: rule.description,
            target_entity: rule.target_entity,
            condition: rule.condition,
            action: rule.action,
          })),
        )
        .returning({ id: rules.id });

      await tx.insert(policy_rule_bindings).values(
        createdRules.map((rule, index) => {
          const templateBinding = templateRules[index]?.binding;
          return {
            tenant_id: input.targetTenantId,
            policy_id: createdPolicy.id,
            rule_id: rule.id,
            enabled: templateBinding?.enabled ?? true,
            required: templateBinding?.required ?? false,
            order_index: templateBinding?.order_index ?? index,
          };
        }),
      );
    }

    copied += 1;
  }

  return copied;
}
