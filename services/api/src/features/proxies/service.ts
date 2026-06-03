import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  TENANT_PROXY_SCOPE,
  type TenantProxyScope,
} from "@customs/shared-constants";
import { db } from "../../db/index.js";
import { proxies } from "../../db/schema.js";
import { generateProxySecret } from "./secrets.js";

export async function listTenantProxies(tenantId: string) {
  return db
    .select({
      id: proxies.id,
      proxy_id: proxies.proxy_id,
      name: proxies.name,
      status: proxies.status,
      tenant_scope: proxies.tenant_scope,
      secret_prefix: proxies.secret_prefix,
      secret_rotated_at: proxies.secret_rotated_at,
      last_seen_at: proxies.last_seen_at,
      created_at: proxies.created_at,
    })
    .from(proxies)
    .where(eq(proxies.tenant_id, tenantId))
    .orderBy(proxies.created_at);
}

export async function createProxy(input: { tenantId: string; name: string }) {
  const proxyId = randomUUID();
  const { rawSecret, secretHash, secretPrefix } = generateProxySecret();

  await db.insert(proxies).values({
    tenant_id: input.tenantId,
    proxy_id: proxyId,
    name: input.name,
    status: "active",
    secret_hash: secretHash,
    secret_prefix: secretPrefix,
  });

  return {
    proxy_id: proxyId,
    secret: rawSecret,
    name: input.name,
    status: "active" as const,
    tenant_scope: TENANT_PROXY_SCOPE.OWNER_ONLY,
    secret_prefix: secretPrefix,
  };
}

export async function updateProxyTenantScope(input: {
  tenantId: string;
  proxyId: string;
  tenantScope: TenantProxyScope;
}) {
  const [row] = await db
    .update(proxies)
    .set({ tenant_scope: input.tenantScope, updated_at: new Date() })
    .where(
      and(
        eq(proxies.proxy_id, input.proxyId),
        eq(proxies.tenant_id, input.tenantId),
      ),
    )
    .returning({
      proxy_id: proxies.proxy_id,
      tenant_id: proxies.tenant_id,
      tenant_scope: proxies.tenant_scope,
    });

  if (!row) {
    return null;
  }

  return {
    proxy_id: row.proxy_id,
    tenant_scope: row.tenant_scope,
  };
}
