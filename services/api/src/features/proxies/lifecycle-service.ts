import { sql, eq, and } from "drizzle-orm";
import { db } from "../../db/index.js";
import { proxies } from "../../db/schema.js";
import { generateProxySecret } from "./secrets.js";
import { insertProxyStatusEvent } from "./status-events.js";

type ProxyStatus = "active" | "disabled" | "revoked";

type LifecycleInput = {
  tenantId: string;
  proxyId: string;
  actorUserId: string;
};

async function setProxyStatus(
  tenantId: string,
  proxyId: string,
  nextStatus: ProxyStatus,
) {
  const now = new Date();
  const [row] = await db
    .update(proxies)
    .set({
      status: nextStatus,
      disabled_at:
        nextStatus === "disabled" || nextStatus === "revoked" ? now : null,
      updated_at: now,
    })
    .where(and(eq(proxies.proxy_id, proxyId), eq(proxies.tenant_id, tenantId)))
    .returning({
      proxy_id: proxies.proxy_id,
      status: proxies.status,
    });

  return row ?? null;
}

export async function disableProxy(input: LifecycleInput) {
  const row = await setProxyStatus(input.tenantId, input.proxyId, "disabled");
  if (!row) return null;

  await insertProxyStatusEvent({
    tenantId: input.tenantId,
    proxyId: input.proxyId,
    eventType: "proxy_disabled",
    actorUserId: input.actorUserId,
  });

  return row;
}

export async function enableProxy(input: LifecycleInput) {
  const row = await setProxyStatus(input.tenantId, input.proxyId, "active");
  if (!row) return null;

  await insertProxyStatusEvent({
    tenantId: input.tenantId,
    proxyId: input.proxyId,
    eventType: "proxy_enabled",
    actorUserId: input.actorUserId,
  });

  return row;
}

export async function revokeProxy(input: LifecycleInput) {
  const row = await setProxyStatus(input.tenantId, input.proxyId, "revoked");
  if (!row) return null;

  await insertProxyStatusEvent({
    tenantId: input.tenantId,
    proxyId: input.proxyId,
    eventType: "proxy_revoked",
    actorUserId: input.actorUserId,
  });

  return row;
}

export async function rotateProxySecret(input: LifecycleInput) {
  const { rawSecret, secretHash, secretPrefix } = generateProxySecret();
  const previousSecretExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const [row] = await db
    .update(proxies)
    .set({
      secret_prev_hash: sql`${proxies.secret_hash}`,
      secret_prev_expires_at: previousSecretExpiresAt,
      secret_hash: secretHash,
      secret_prefix: secretPrefix,
      secret_rotated_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(proxies.proxy_id, input.proxyId),
        eq(proxies.tenant_id, input.tenantId),
      ),
    )
    .returning({
      proxy_id: proxies.proxy_id,
      secret_rotated_at: proxies.secret_rotated_at,
    });

  if (!row) return null;

  await insertProxyStatusEvent({
    tenantId: input.tenantId,
    proxyId: input.proxyId,
    eventType: "secret_rotated",
    actorUserId: input.actorUserId,
  });

  return {
    proxy_id: row.proxy_id,
    secret: rawSecret,
    secret_prefix: secretPrefix,
    secret_rotated_at: row.secret_rotated_at,
    previous_secret_expires_at: previousSecretExpiresAt,
  };
}
