import { eq } from "drizzle-orm";
import { TENANT_KIND } from "@customs/shared-constants";
import { hashSecret } from "../auth/hashing.js";
import {
  DEFAULT_FIRST_TENANT_NAME,
  DEFAULT_PLATFORM_TENANT_NAME,
} from "./constants.js";
import { db } from "../db/index.js";
import { proxies, tenants } from "../db/schema.js";
import {
  ensureTenantEntitlements,
  ensureStarterPolicies,
  provisionCustomerTenantDefaults,
} from "./tenant-provisioning.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type InitResult = {
  tenantId: string | null;
  platformTenantId: string | null;
  customerTenantId: string | null;
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
      platformTenantId: null,
      customerTenantId: null,
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
  const defaultPlatformTenantName = DEFAULT_PLATFORM_TENANT_NAME;
  const defaultCustomerTenantName = DEFAULT_FIRST_TENANT_NAME;
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

    const tenants = await resolveBundledTenants({
      tx,
      setupFirstTenant,
      defaultPlatformTenantName,
      defaultCustomerTenantName,
    });

    if (tenants.created) {
      tenantCreated = true;
    }

    if (tenants.platformTenantId) {
      if (setupDefaultPolicies) {
        policiesCreated += await ensureStarterPolicies(
          tx,
          tenants.platformTenantId,
        );
      }
    }

    if (tenants.customerTenantId) {
      await ensureTenantEntitlements(tx, tenants.customerTenantId);

      if (setupDefaultPolicies) {
        const provisioned = await provisionCustomerTenantDefaults(tx, {
          tenantId: tenants.customerTenantId,
          platformTenantId: tenants.platformTenantId,
        });
        policiesCreated += provisioned.policiesCreated;
      }
    }

    if (tenants.platformTenantId) {
      if (setupFirstProxy) {
        if (!proxyId || !proxySecret) {
          throw new Error(
            "BOOTSTRAP_PROXY_ID and BOOTSTRAP_PROXY_KEY must be resolved before bundled proxy bootstrap",
          );
        }

        proxyCreated = await ensureBundledProxy(tx, {
          tenantId: tenants.platformTenantId,
          proxyId,
          proxySecret,
          defaultProxyName,
        });
      }
    }

    return {
      tenantId: tenants.customerTenantId,
      platformTenantId: tenants.platformTenantId,
      customerTenantId: tenants.customerTenantId,
      tenantCreated,
      proxyCreated,
      policiesCreated,
    };
  });
}

async function resolveBundledTenants(input: {
  tx: Tx;
  setupFirstTenant: boolean;
  defaultPlatformTenantName: string;
  defaultCustomerTenantName: string;
}): Promise<{
  platformTenantId: string | null;
  customerTenantId: string | null;
  created: boolean;
}> {
  const existingTenants = await input.tx
    .select({ id: tenants.id, name: tenants.name, kind: tenants.kind })
    .from(tenants)
    .orderBy(tenants.created_at)
    .limit(3);

  const existingPlatformTenant = existingTenants.find(
    (tenant) => tenant.kind === TENANT_KIND.PLATFORM,
  );
  const existingCustomerTenant = existingTenants.find(
    (tenant) => tenant.kind === TENANT_KIND.CUSTOMER,
  );

  if (existingTenants.length === 0) {
    if (!input.setupFirstTenant) {
      return {
        platformTenantId: null,
        customerTenantId: null,
        created: false,
      };
    }

    const [platformTenant] = await input.tx
      .insert(tenants)
      .values({
        name: input.defaultPlatformTenantName,
        kind: TENANT_KIND.PLATFORM,
      })
      .returning({ id: tenants.id });
    const [customerTenant] = await input.tx
      .insert(tenants)
      .values({
        name: input.defaultCustomerTenantName,
        kind: TENANT_KIND.CUSTOMER,
      })
      .returning({ id: tenants.id });

    return {
      platformTenantId: platformTenant.id,
      customerTenantId: customerTenant.id,
      created: true,
    };
  }

  if (existingTenants.length <= 2) {
    let platformTenantId = existingPlatformTenant?.id ?? null;
    let customerTenantId = existingCustomerTenant?.id ?? null;
    let created = false;

    if (!platformTenantId && input.setupFirstTenant) {
      const [platformTenant] = await input.tx
        .insert(tenants)
        .values({
          name: input.defaultPlatformTenantName,
          kind: TENANT_KIND.PLATFORM,
        })
        .returning({ id: tenants.id });
      platformTenantId = platformTenant.id;
      created = true;
    }

    if (!customerTenantId && input.setupFirstTenant) {
      const [customerTenant] = await input.tx
        .insert(tenants)
        .values({
          name: input.defaultCustomerTenantName,
          kind: TENANT_KIND.CUSTOMER,
        })
        .returning({ id: tenants.id });
      customerTenantId = customerTenant.id;
      created = true;
    }

    return {
      platformTenantId,
      customerTenantId,
      created,
    };
  }

  return {
    platformTenantId: existingPlatformTenant?.id ?? null,
    customerTenantId: existingCustomerTenant?.id ?? null,
    created: false,
  };
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
