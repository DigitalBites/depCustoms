import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { checkDatabaseReadiness } from "../app/db-readiness.js";
import { DEFAULT_FIRST_TENANT_NAME } from "./constants.js";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { proxies, tenants } from "../db/schema.js";

export type BootstrapStatusState =
  | "waiting_for_db"
  | "schema_not_ready"
  | "auth_unreachable"
  | "no_users"
  | "needs_setup"
  | "ready";

export type BootstrapStatus = {
  ok: boolean;
  state: BootstrapStatusState;
  bundledMode: boolean;
  setup: {
    firstTenantEnabled: boolean;
    firstProxyEnabled: boolean;
    defaultPoliciesEnabled: boolean;
  };
  checks: {
    dbReady: boolean;
    schemaReady: boolean;
    authReachable: boolean;
    usersExist: boolean;
    ownerMembershipExists: boolean;
    tenantExists: boolean;
    placeholderTenantExists: boolean;
    bundledProxyConfigured: boolean;
    bundledProxyRegistered: boolean;
  };
  nextStep: "wait_for_runtime" | "sign_in" | "complete_setup" | "done";
  ts: string;
};

type CountRow = { count: string | number };

export async function getBootstrapStatus(): Promise<BootstrapStatus> {
  const bundledMode = (process.env.BOOTSTRAP_MODE ?? "bundled") === "bundled";
  const firstTenantEnabled = parseBoolean(
    process.env.BOOTSTRAP_SETUP_FIRST_TENANT,
    true,
  );
  const firstProxyEnabled = parseBoolean(
    process.env.BOOTSTRAP_SETUP_FIRST_PROXY,
    true,
  );
  const defaultPoliciesEnabled = parseBoolean(
    process.env.BOOTSTRAP_SETUP_DEFAULT_POLICIES,
    true,
  );
  const proxyId =
    process.env.BOOTSTRAP_PROXY_ID?.trim() ?? process.env.PROXY_ID?.trim() ?? "";

  let dbReady = false;
  let schemaReady = false;
  let authReachable = false;
  let usersExist = false;
  let ownerMembershipExists = false;
  let tenantExists = false;
  let placeholderTenantExists = false;
  let bundledProxyRegistered = false;

  try {
    const readiness = await checkDatabaseReadiness();
    dbReady = true;
    schemaReady = readiness.ok;

    if (!schemaReady) {
      return buildBootstrapStatus({
        state: "schema_not_ready",
        bundledMode,
        firstTenantEnabled,
        firstProxyEnabled,
        defaultPoliciesEnabled,
        dbReady,
        schemaReady,
        authReachable,
        usersExist,
        ownerMembershipExists,
        tenantExists,
        placeholderTenantExists,
        bundledProxyConfigured: proxyId !== "",
        bundledProxyRegistered,
      });
    }

    authReachable = await checkGotrueHealth();
    if (!authReachable) {
      return buildBootstrapStatus({
        state: "auth_unreachable",
        bundledMode,
        firstTenantEnabled,
        firstProxyEnabled,
        defaultPoliciesEnabled,
        dbReady,
        schemaReady,
        authReachable,
        usersExist,
        ownerMembershipExists,
        tenantExists,
        placeholderTenantExists,
        bundledProxyConfigured: proxyId !== "",
        bundledProxyRegistered,
      });
    }

    const [userCountRow] = await db.execute<CountRow>(sql`
      SELECT COUNT(*)::int AS count
      FROM auth.users
    `);
    usersExist = toCount(userCountRow) > 0;

    const [ownerCountRow] = await db.execute<CountRow>(sql`
      SELECT COUNT(*)::int AS count
      FROM memberships
      WHERE role = 'owner'
    `);
    ownerMembershipExists = toCount(ownerCountRow) > 0;

    const [tenantCountRow] = await db.execute<CountRow>(sql`
      SELECT COUNT(*)::int AS count
      FROM tenants
    `);
    tenantExists = toCount(tenantCountRow) > 0;

    const [placeholderTenant] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.name, DEFAULT_FIRST_TENANT_NAME))
      .limit(1);
    placeholderTenantExists = Boolean(placeholderTenant);

    if (bundledMode && firstProxyEnabled && proxyId) {
      const [bundledProxy] = await db
        .select({ id: proxies.id })
        .from(proxies)
        .where(eq(proxies.proxy_id, proxyId))
        .limit(1);
      bundledProxyRegistered = Boolean(bundledProxy);
    }
  } catch {
    return buildBootstrapStatus({
      state: "waiting_for_db",
      bundledMode,
      firstTenantEnabled,
      firstProxyEnabled,
      defaultPoliciesEnabled,
      dbReady,
      schemaReady,
      authReachable,
      usersExist,
      ownerMembershipExists,
      tenantExists,
      placeholderTenantExists,
      bundledProxyConfigured: proxyId !== "",
      bundledProxyRegistered,
    });
  }

  const bundledProxyConfigured = proxyId !== "";
  const proxyReady =
    !bundledMode ||
    !firstProxyEnabled ||
    !bundledProxyConfigured ||
    bundledProxyRegistered;

  const state: BootstrapStatusState = !usersExist
    ? "no_users"
    : !ownerMembershipExists || placeholderTenantExists || !proxyReady
      ? "needs_setup"
      : "ready";

  return buildBootstrapStatus({
    state,
    bundledMode,
    firstTenantEnabled,
    firstProxyEnabled,
    defaultPoliciesEnabled,
    dbReady,
    schemaReady,
    authReachable,
    usersExist,
    ownerMembershipExists,
    tenantExists,
    placeholderTenantExists,
    bundledProxyConfigured,
    bundledProxyRegistered,
  });
}

async function checkGotrueHealth(): Promise<boolean> {
  if (!config.gotrueUrl) {
    return false;
  }

  try {
    const response = await fetch(`${config.gotrueUrl}/health`, {
      signal: AbortSignal.timeout(config.gotrueRequestTimeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function buildBootstrapStatus(input: {
  state: BootstrapStatusState;
  bundledMode: boolean;
  firstTenantEnabled: boolean;
  firstProxyEnabled: boolean;
  defaultPoliciesEnabled: boolean;
  dbReady: boolean;
  schemaReady: boolean;
  authReachable: boolean;
  usersExist: boolean;
  ownerMembershipExists: boolean;
  tenantExists: boolean;
  placeholderTenantExists: boolean;
  bundledProxyConfigured: boolean;
  bundledProxyRegistered: boolean;
}): BootstrapStatus {
  return {
    ok: input.state === "ready",
    state: input.state,
    bundledMode: input.bundledMode,
    setup: {
      firstTenantEnabled: input.firstTenantEnabled,
      firstProxyEnabled: input.firstProxyEnabled,
      defaultPoliciesEnabled: input.defaultPoliciesEnabled,
    },
    checks: {
      dbReady: input.dbReady,
      schemaReady: input.schemaReady,
      authReachable: input.authReachable,
      usersExist: input.usersExist,
      ownerMembershipExists: input.ownerMembershipExists,
      tenantExists: input.tenantExists,
      placeholderTenantExists: input.placeholderTenantExists,
      bundledProxyConfigured: input.bundledProxyConfigured,
      bundledProxyRegistered: input.bundledProxyRegistered,
    },
    nextStep:
      input.state === "ready"
        ? "done"
        : input.state === "no_users" ||
            (input.state === "needs_setup" && !input.ownerMembershipExists)
          ? "sign_in"
          : input.state === "needs_setup"
            ? "complete_setup"
            : "wait_for_runtime",
    ts: new Date().toISOString(),
  };
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

function toCount(row: CountRow | undefined): number {
  if (!row) return 0;
  const raw =
    typeof row.count === "number" ? row.count : Number.parseInt(row.count, 10);
  return Number.isFinite(raw) ? raw : 0;
}
