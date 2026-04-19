import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
    secret_prefix: secretPrefix,
  };
}
