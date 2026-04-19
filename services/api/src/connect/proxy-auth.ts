import type { Interceptor } from "@connectrpc/connect";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { verifyProxyRuntimeToken } from "../auth/proxy-jwt.js";
import { db } from "../db/index.js";
import { proxies } from "../db/schema.js";
import { log } from "../logger.js";
import { proxyAuthConnectError } from "./shared.js";
import { verifiedProxyContextKey } from "./proxy-context.js";

export type ProxyCredentials = {
  proxySecret: string | undefined;
  proxyId: string | undefined;
  proxyIp: string | null;
};

export type BootstrapProxyRow = {
  id: string;
  proxy_id: string;
  tenant_id: string;
  status: string;
  secret_hash: string;
  secret_prev_hash: string | null;
  secret_prev_expires_at: Date | null;
};

function hashesMatch(expectedHex: string | null, providedHex: string): boolean {
  if (!expectedHex) return false;

  const expected = Buffer.from(expectedHex, "utf8");
  const provided = Buffer.from(providedHex, "utf8");
  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}

export async function requireBootstrapAuthenticatedProxy({
  proxySecret,
  proxyId,
  proxyIp,
}: ProxyCredentials): Promise<BootstrapProxyRow> {
  if (!proxySecret || !proxyId) {
    log.warn("proxy_auth_failed", {
      reason: "missing_credentials",
      proxy_id: proxyId ?? null,
      proxy_ip: proxyIp,
    });
    throw proxyAuthConnectError("unregistered_proxy");
  }

  const secretHash = createHash("sha256").update(proxySecret).digest("hex");
  const [proxyRow] = await db
    .select({
      id: proxies.id,
      proxy_id: proxies.proxy_id,
      tenant_id: proxies.tenant_id,
      status: proxies.status,
      secret_hash: proxies.secret_hash,
      secret_prev_hash: proxies.secret_prev_hash,
      secret_prev_expires_at: proxies.secret_prev_expires_at,
    })
    .from(proxies)
    .where(eq(proxies.proxy_id, proxyId))
    .limit(1);

  if (!proxyRow) {
    log.warn("proxy_auth_failed", {
      reason: "unregistered_proxy",
      proxy_id: proxyId,
      proxy_ip: proxyIp,
    });
    throw proxyAuthConnectError("unregistered_proxy");
  }

  const previousSecretStillValid =
    hashesMatch(proxyRow.secret_prev_hash, secretHash) &&
    proxyRow.secret_prev_expires_at !== null &&
    proxyRow.secret_prev_expires_at > new Date();

  if (
    !hashesMatch(proxyRow.secret_hash, secretHash) &&
    !previousSecretStillValid
  ) {
    log.warn("proxy_auth_failed", {
      reason: "invalid_proxy_secret",
      proxy_id: proxyId,
      tenant_id: proxyRow.tenant_id,
      proxy_ip: proxyIp,
    });
    throw proxyAuthConnectError("invalid_proxy_secret");
  }

  return proxyRow;
}

export function proxyJwtAuthInterceptor(): Interceptor {
  return (next) => async (req) => {
    const authorization = req.header.get("authorization") ?? "";
    const proxyIp = req.header.get("x-proxy-remote-addr") || null;
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";

    if (!token) {
      log.warn("proxy_auth_failed", {
        reason: "missing_runtime_token",
        proxy_ip: proxyIp,
      });
      throw proxyAuthConnectError("invalid_proxy_token");
    }

    try {
      const claims = await verifyProxyRuntimeToken(token);
      req.contextValues.set(verifiedProxyContextKey, {
        proxyId: claims.proxyId,
        tenantId: claims.tenantId,
        proxyIp,
      });
    } catch (err) {
      log.warn("proxy_auth_failed", {
        reason: "invalid_runtime_token",
        proxy_ip: proxyIp,
        error: err instanceof Error ? err.message : String(err),
      });
      throw proxyAuthConnectError("invalid_proxy_token");
    }

    return await next(req);
  };
}
