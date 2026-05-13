import { and, eq, isNull } from "drizzle-orm";
import {
  ENFORCEMENT_MODE,
  POLICY_SCOPE,
  POLICY_STATUS,
  RULE_TARGET_ENTITY,
} from "@customs/shared-constants";
import { hashSecret } from "../auth/hashing.js";
import { DEFAULT_FIRST_TENANT_NAME } from "./constants.js";
import { db } from "../db/index.js";
import {
  policies,
  policy_rule_bindings,
  proxies,
  rules,
  tenant_entitlements,
  tenants,
} from "../db/schema.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type InitResult = {
  tenantId: string | null;
  tenantCreated: boolean;
  proxyCreated: boolean;
  policiesCreated: number;
};

export async function runBundledBootstrapInitialization(
  env: NodeJS.ProcessEnv,
): Promise<InitResult> {
  if ((env.BOOTSTRAP_MODE ?? "bundled") !== "bundled") {
    return {
      tenantId: null,
      tenantCreated: false,
      proxyCreated: false,
      policiesCreated: 0,
    };
  }

  const setupFirstTenant = parseBoolean(env.BOOTSTRAP_SETUP_FIRST_TENANT, true);
  const setupFirstProxy = parseBoolean(env.BOOTSTRAP_SETUP_FIRST_PROXY, true);
  const setupDefaultPolicies = parseBoolean(
    env.BOOTSTRAP_SETUP_DEFAULT_POLICIES,
    true,
  );
  const defaultTenantName = DEFAULT_FIRST_TENANT_NAME;
  const defaultProxyName = env.BOOTSTRAP_DEFAULT_PROXY_NAME ?? "bundled-proxy";

  const proxyId = env.BOOTSTRAP_PROXY_ID?.trim() ?? env.PROXY_ID?.trim() ?? "";
  const proxySecret =
    env.BOOTSTRAP_PROXY_KEY?.trim() ??
    env.PROXY_CONTROL_PLANE_SECRET?.trim() ??
    "";

  return await db.transaction(async (tx) => {
    let tenantCreated = false;
    let proxyCreated = false;
    let policiesCreated = 0;

    const tenant = await resolveBundledTenant({
      tx,
      setupFirstTenant,
      defaultTenantName,
    });

    if (tenant.created) {
      tenantCreated = true;
    }

    if (tenant.id) {
      await ensureTenantEntitlements(tx, tenant.id);

      if (setupDefaultPolicies) {
        policiesCreated = await ensureStarterPolicies(tx, tenant.id);
      }

      if (setupFirstProxy) {
        if (!proxyId || !proxySecret) {
          throw new Error(
            "BOOTSTRAP_PROXY_ID and BOOTSTRAP_PROXY_KEY must be resolved before bundled proxy bootstrap",
          );
        }

        proxyCreated = await ensureBundledProxy(tx, {
          tenantId: tenant.id,
          proxyId,
          proxySecret,
          defaultProxyName,
        });
      }
    }

    return {
      tenantId: tenant.id,
      tenantCreated,
      proxyCreated,
      policiesCreated,
    };
  });
}

async function resolveBundledTenant(input: {
  tx: Tx;
  setupFirstTenant: boolean;
  defaultTenantName: string;
}): Promise<{ id: string | null; created: boolean }> {
  const existingTenants = await input.tx
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .orderBy(tenants.created_at)
    .limit(2);

  if (existingTenants.length === 0) {
    if (!input.setupFirstTenant) {
      return { id: null, created: false };
    }

    const [tenant] = await input.tx
      .insert(tenants)
      .values({ name: input.defaultTenantName })
      .returning({ id: tenants.id });

    return { id: tenant.id, created: true };
  }

  if (existingTenants.length === 1) {
    return { id: existingTenants[0].id, created: false };
  }

  return { id: null, created: false };
}

async function ensureTenantEntitlements(
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
    serve_mode: "SERVE_MODE_REDIRECT",
    cache_ttl_seconds: 300,
    mcp_enabled: true,
  });
}

async function ensureStarterPolicies(
  tx: Tx,
  tenantId: string,
): Promise<number> {
  let created = 0;

  created += await ensurePolicy(tx, {
    tenantId,
    name: "Default Security Policy",
    description:
      "Blocks packages with critical or high CVEs detected by OSV and demonstrates fail-closed handling when OSV data is unavailable",
    category: "vulnerability-management",
    priority: 100,
    rules: [
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
  });

  created += await ensurePolicy(tx, {
    tenantId,
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
  });

  return created;
}

async function ensurePolicy(
  tx: Tx,
  input: {
    tenantId: string;
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
  },
): Promise<number> {
  const [existing] = await tx
    .select({ id: policies.id })
    .from(policies)
    .where(
      and(
        eq(policies.tenant_id, input.tenantId),
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
      tenant_id: input.tenantId,
      project_id: null,
      name: input.name,
      description: input.description,
      category: input.category,
      scope: POLICY_SCOPE.GLOBAL,
      status: POLICY_STATUS.ACTIVE,
      enforcement_mode: ENFORCEMENT_MODE.ENFORCING,
      priority: input.priority,
      created_by: null,
    })
    .returning({ id: policies.id });

  const createdRules = await tx
    .insert(rules)
    .values(
      input.rules.map((rule) => ({
        tenant_id: input.tenantId,
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
      tenant_id: input.tenantId,
      policy_id: policy.id,
      rule_id: rule.id,
      enabled: true,
      order_index: index,
    })),
  );

  return 1;
}

async function ensureBundledProxy(
  tx: Tx,
  input: {
    tenantId: string;
    proxyId: string;
    proxySecret: string;
    defaultProxyName: string;
  },
): Promise<boolean> {
  const [existing] = await tx
    .select({
      tenant_id: proxies.tenant_id,
      secret_hash: proxies.secret_hash,
    })
    .from(proxies)
    .where(eq(proxies.proxy_id, input.proxyId))
    .limit(1);

  const secretHash = hashSecret(input.proxySecret);
  const secretPrefix = input.proxySecret.slice(0, 12);

  if (existing) {
    if (existing.tenant_id !== input.tenantId) {
      throw new Error(
        `Bundled proxy ${input.proxyId} is already registered to a different tenant`,
      );
    }

    if (existing.secret_hash !== secretHash) {
      throw new Error(
        `Bundled proxy ${input.proxyId} already exists but the configured secret does not match`,
      );
    }

    return false;
  }

  await tx.insert(proxies).values({
    tenant_id: input.tenantId,
    proxy_id: input.proxyId,
    name: input.defaultProxyName,
    status: "active",
    secret_hash: secretHash,
    secret_prefix: secretPrefix,
  });

  return true;
}

function parseBoolean(
  rawValue: string | undefined,
  defaultValue: boolean,
): boolean {
  if (rawValue === undefined) {
    return defaultValue;
  }
  return rawValue === "true";
}
