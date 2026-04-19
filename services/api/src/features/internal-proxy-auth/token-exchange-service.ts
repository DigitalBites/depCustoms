import { eq } from "drizzle-orm";
import { issueProxyRuntimeToken } from "../../auth/proxy-jwt.js";
import { db } from "../../db/index.js";
import { proxies } from "../../db/schema.js";
import { insertProxyStatusEvent } from "../proxies/status-events.js";
import { authenticateBootstrapProxy } from "./bootstrap-auth-service.js";

export async function exchangeProxyRuntimeToken(input: {
  proxyId: string | undefined;
  proxySecret: string | undefined;
  proxyIp: string | null;
}): Promise<
  | {
      ok: true;
      accessToken: string;
      expiresAt: Date;
      refreshAfter: Date;
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      detail: string | null;
    }
> {
  const authResult = await authenticateBootstrapProxy(input);
  if (!authResult.ok) {
    if (authResult.auditProxy) {
      if (
        authResult.code === "PROXY_DISABLED" ||
        authResult.code === "PROXY_REVOKED"
      ) {
        await insertProxyStatusEvent({
          tenantId: authResult.auditProxy.tenantId,
          proxyId: authResult.auditProxy.proxyId,
          proxyIp: input.proxyIp,
          eventType: "token_exchange_attempt",
        });
      }

      await insertProxyStatusEvent({
        tenantId: authResult.auditProxy.tenantId,
        proxyId: authResult.auditProxy.proxyId,
        proxyIp: input.proxyIp,
        eventType: "token_exchange_failed",
        detail: authResult.auditDetail,
      });
    }

    return {
      ok: false,
      status: authResult.status,
      code: authResult.code,
      message: authResult.message,
      detail: authResult.detail,
    };
  }

  const proxy = authResult.proxy;

  await insertProxyStatusEvent({
    tenantId: proxy.tenant_id,
    proxyId: proxy.proxy_id,
    proxyIp: input.proxyIp,
    eventType: "token_exchange_attempt",
  });

  const token = await issueProxyRuntimeToken({
    proxyId: proxy.proxy_id,
    tenantId: proxy.tenant_id,
  });

  db.update(proxies)
    .set({ last_seen_at: new Date() })
    .where(eq(proxies.id, proxy.id))
    .catch(() => {});

  await insertProxyStatusEvent({
    tenantId: proxy.tenant_id,
    proxyId: proxy.proxy_id,
    proxyIp: input.proxyIp,
    eventType: "token_issued",
  });

  return {
    ok: true,
    accessToken: token.accessToken,
    expiresAt: token.expiresAt,
    refreshAfter: token.refreshAfter,
  };
}
