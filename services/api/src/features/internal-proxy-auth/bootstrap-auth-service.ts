import { ConnectError } from "@connectrpc/connect";
import { eq } from "drizzle-orm";
import { requireBootstrapAuthenticatedProxy } from "../../connect/proxy-auth.js";
import { db } from "../../db/index.js";
import { proxies } from "../../db/schema.js";

type BootstrapAuthInput = {
  proxyId: string | undefined;
  proxySecret: string | undefined;
  proxyIp: string | null;
};

type BootstrapAuthSuccess = {
  ok: true;
  proxy: Awaited<ReturnType<typeof requireBootstrapAuthenticatedProxy>>;
};

type BootstrapAuthFailure = {
  ok: false;
  status: number;
  code: string;
  message: string;
  detail: string | null;
  auditProxy: {
    tenantId: string;
    proxyId: string;
  } | null;
  auditDetail: string;
};

export type BootstrapAuthResult = BootstrapAuthSuccess | BootstrapAuthFailure;

export async function authenticateBootstrapProxy(
  input: BootstrapAuthInput,
): Promise<BootstrapAuthResult> {
  try {
    const proxy = await requireBootstrapAuthenticatedProxy(input);

    if (proxy.status === "disabled") {
      return {
        ok: false,
        status: 403,
        code: "PROXY_DISABLED",
        message: "Proxy is disabled",
        detail: null,
        auditProxy: {
          tenantId: proxy.tenant_id,
          proxyId: proxy.proxy_id,
        },
        auditDetail: "proxy_disabled",
      };
    }

    if (proxy.status === "revoked") {
      return {
        ok: false,
        status: 403,
        code: "PROXY_REVOKED",
        message: "Proxy is revoked",
        detail: null,
        auditProxy: {
          tenantId: proxy.tenant_id,
          proxyId: proxy.proxy_id,
        },
        auditDetail: "proxy_revoked",
      };
    }

    return { ok: true, proxy };
  } catch (err) {
    const code =
      err instanceof ConnectError && err.rawMessage === "invalid_proxy_secret"
        ? "INVALID_PROXY_SECRET"
        : "UNREGISTERED_PROXY";

    let auditProxy: BootstrapAuthFailure["auditProxy"] = null;
    if (input.proxyId) {
      const [proxy] = await db
        .select({
          tenant_id: proxies.tenant_id,
          proxy_id: proxies.proxy_id,
        })
        .from(proxies)
        .where(eq(proxies.proxy_id, input.proxyId))
        .limit(1);

      if (proxy) {
        auditProxy = {
          tenantId: proxy.tenant_id,
          proxyId: proxy.proxy_id,
        };
      }
    }

    return {
      ok: false,
      status: 401,
      code,
      message:
        code === "INVALID_PROXY_SECRET"
          ? "Proxy secret is incorrect"
          : "Proxy is not registered",
      detail: null,
      auditProxy,
      auditDetail: err instanceof ConnectError ? err.rawMessage : String(err),
    };
  }
}
