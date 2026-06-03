import { randomUUID } from "node:crypto";
import { TENANT_KIND, type TenantKind } from "@customs/shared-constants";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { memberships, tenants } from "../../db/schema.js";
import { log } from "../../logger.js";
import {
  DEFAULT_FIRST_TENANT_NAME,
  DEFAULT_PLATFORM_TENANT_NAME,
} from "../../bootstrap/constants.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type TokenHookPayload = {
  user_id: string;
  claims?: Record<string, unknown>;
};

type MembershipRow = {
  tenant_id: string;
  role: string;
  tenant_name: string;
  tenant_kind: TenantKind;
};

type ClaimableTenantRow = {
  tenant_id: string;
  tenant_name: string;
  tenant_kind: TenantKind;
};

type CountRow = {
  count: number;
};

type OAuthClientRow = {
  registration_type: string;
  client_type: string;
  token_endpoint_auth_method: string;
  redirect_uris: string;
};

function isLocalhostRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    const host = parsed.hostname;
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (host === "localhost" || host === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

async function isMcpEligibleOAuthClient(clientId: string): Promise<boolean> {
  const rows = await db.execute<OAuthClientRow>(sql`
    SELECT      registration_type,
      client_type,
      token_endpoint_auth_method,
      redirect_uris
    FROM auth.oauth_clients
    WHERE id = ${clientId}::uuid
      AND deleted_at IS NULL
    LIMIT 1
  `);

  const client = rows[0];
  if (!client) {
    return false;
  }

  if (
    client.registration_type !== "dynamic" ||
    client.client_type !== "public" ||
    client.token_endpoint_auth_method !== "none"
  ) {
    return false;
  }

  const redirectUris = client.redirect_uris
    .split(",")
    .map((uri) => uri.trim())
    .filter((uri) => uri.length > 0);

  return redirectUris.length > 0 && redirectUris.every(isLocalhostRedirectUri);
}

async function mergeAudiences(
  claims: Record<string, unknown>,
): Promise<string[] | string | undefined> {
  const rawAud = claims.aud;
  const currentAudiences = Array.isArray(rawAud)
    ? rawAud.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      )
    : typeof rawAud === "string" && rawAud.length > 0
      ? [rawAud]
      : [];

  if (typeof claims.client_id !== "string" || claims.client_id.length === 0) {
    if (currentAudiences.length === 0) {
      return undefined;
    }

    return Array.isArray(rawAud) ? currentAudiences : currentAudiences[0];
  }

  const isEligibleMcpClient = await isMcpEligibleOAuthClient(claims.client_id);
  if (!isEligibleMcpClient) {
    if (currentAudiences.length === 0) {
      return undefined;
    }

    return Array.isArray(rawAud) ? currentAudiences : currentAudiences[0];
  }

  const mergedAudiences = [...new Set([...currentAudiences, "mcp"])];
  return mergedAudiences;
}

export function parseTokenHookPayload(body: string): TokenHookPayload {
  return JSON.parse(body) as TokenHookPayload;
}

function sortMembershipsForDefaultActiveTenant(
  rows: MembershipRow[],
): MembershipRow[] {
  return [...rows].sort((a, b) => {
    if (
      a.tenant_kind === TENANT_KIND.CUSTOMER &&
      b.tenant_kind !== TENANT_KIND.CUSTOMER
    ) {
      return -1;
    }
    if (
      a.tenant_kind !== TENANT_KIND.CUSTOMER &&
      b.tenant_kind === TENANT_KIND.CUSTOMER
    ) {
      return 1;
    }
    return 0;
  });
}

async function createTenantOwnerMembership(
  tx: Tx,
  input: {
    userId: string;
    tenantName: string;
    tenantKind: TenantKind;
  },
): Promise<MembershipRow> {
  const newTenantId = randomUUID();
  await tx.insert(tenants).values({
    id: newTenantId,
    name: input.tenantName,
    kind: input.tenantKind,
  });
  await tx.insert(memberships).values({
    user_id: input.userId,
    tenant_id: newTenantId,
    role: "owner",
  });

  return {
    tenant_id: newTenantId,
    role: "owner",
    tenant_name: input.tenantName,
    tenant_kind: input.tenantKind,
  };
}

async function claimTenantOwnerMembership(
  tx: Tx,
  input: {
    userId: string;
    tenant: ClaimableTenantRow;
  },
): Promise<MembershipRow> {
  await tx.insert(memberships).values({
    user_id: input.userId,
    tenant_id: input.tenant.tenant_id,
    role: "owner",
  });

  return {
    tenant_id: input.tenant.tenant_id,
    role: "owner",
    tenant_name: input.tenant.tenant_name,
    tenant_kind: input.tenant.tenant_kind,
  };
}

export async function buildTokenHookClaims(
  payload: TokenHookPayload,
): Promise<Record<string, unknown>> {
  const userId = payload.user_id;
  const claims = payload.claims ?? {};
  let userMemberships: MembershipRow[] = [];

  await db.transaction(async (tx) => {
    userMemberships = await tx
      .select({
        tenant_id: memberships.tenant_id,
        role: memberships.role,
        tenant_name: tenants.name,
        tenant_kind: tenants.kind,
      })
      .from(memberships)
      .innerJoin(tenants, eq(memberships.tenant_id, tenants.id))
      .where(eq(memberships.user_id, userId));

    if (userMemberships.length === 0) {
      const claimableTenants = await tx.execute<ClaimableTenantRow>(sql`
        SELECT t.id AS tenant_id, t.name AS tenant_name, t.kind AS tenant_kind
        FROM tenants t
        LEFT JOIN memberships m ON m.tenant_id = t.id
        GROUP BY t.id, t.name, t.kind
        HAVING COUNT(m.id) = 0
        ORDER BY t.created_at ASC
        LIMIT 3
      `);

      const claimablePlatformTenant = claimableTenants.find(
        (tenant) => tenant.tenant_kind === TENANT_KIND.PLATFORM,
      );
      const claimableCustomerTenant = claimableTenants.find(
        (tenant) => tenant.tenant_kind === TENANT_KIND.CUSTOMER,
      );
      const canClaimInitialTenantPair =
        claimableTenants.length <= 2 &&
        Boolean(claimablePlatformTenant || claimableCustomerTenant);

      if (canClaimInitialTenantPair) {
        const claimedMemberships: MembershipRow[] = [];
        if (claimablePlatformTenant) {
          claimedMemberships.push(
            await claimTenantOwnerMembership(tx, {
              userId,
              tenant: claimablePlatformTenant,
            }),
          );
        }

        if (claimableCustomerTenant) {
          claimedMemberships.push(
            await claimTenantOwnerMembership(tx, {
              userId,
              tenant: claimableCustomerTenant,
            }),
          );
        } else if (claimablePlatformTenant) {
          claimedMemberships.push(
            await createTenantOwnerMembership(tx, {
              userId,
              tenantName: DEFAULT_FIRST_TENANT_NAME,
              tenantKind: TENANT_KIND.CUSTOMER,
            }),
          );
        }

        userMemberships =
          sortMembershipsForDefaultActiveTenant(claimedMemberships);

        log.info("tenant_claimed", {
          tenant_id: userMemberships.map((membership) => membership.tenant_id),
          user_id: userId,
        });
      } else {
        const [tenantCountRow] = await tx.execute<CountRow>(sql`
          SELECT COUNT(*)::int AS count
          FROM tenants
        `);

        if ((tenantCountRow?.count ?? 0) === 0) {
          userMemberships = sortMembershipsForDefaultActiveTenant([
            await createTenantOwnerMembership(tx, {
              userId,
              tenantName: DEFAULT_PLATFORM_TENANT_NAME,
              tenantKind: TENANT_KIND.PLATFORM,
            }),
            await createTenantOwnerMembership(tx, {
              userId,
              tenantName: DEFAULT_FIRST_TENANT_NAME,
              tenantKind: TENANT_KIND.CUSTOMER,
            }),
          ]);
        } else {
          userMemberships = [
            await createTenantOwnerMembership(tx, {
              userId,
              tenantName: DEFAULT_FIRST_TENANT_NAME,
              tenantKind: TENANT_KIND.CUSTOMER,
            }),
          ];
        }

        log.info("tenant_auto_created", {
          tenant_id: userMemberships.map((membership) => membership.tenant_id),
          user_id: userId,
        });
      }
    }
  });

  userMemberships = sortMembershipsForDefaultActiveTenant(userMemberships);
  const preferredTenantId = (
    claims.app_metadata as Record<string, unknown> | undefined
  )?.preferred_tenant_id as string | undefined;
  const preferredMembership = preferredTenantId
    ? userMemberships.find(
        (membership) => membership.tenant_id === preferredTenantId,
      )
    : undefined;
  const activeMembership = preferredMembership ?? userMemberships[0];
  const aud = await mergeAudiences(claims);

  return {
    ...claims,
    ...(aud ? { aud } : {}),
    tenant_id: activeMembership.tenant_id,
    app_metadata: {
      ...(claims.app_metadata as Record<string, unknown> | undefined),
      tenant_id: activeMembership.tenant_id,
      tenant_kind: activeMembership.tenant_kind,
      role: activeMembership.role,
      tenants: userMemberships.map((membership) => ({
        tenant_id: membership.tenant_id,
        tenant_name: membership.tenant_name,
        tenant_kind: membership.tenant_kind,
        role: membership.role,
      })),
    },
  };
}
