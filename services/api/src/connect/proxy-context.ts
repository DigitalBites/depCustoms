import { Code, ConnectError, createContextKey } from "@connectrpc/connect";
import type { HandlerContext } from "@connectrpc/connect";
import {
  TENANT_PROXY_SCOPE,
  type TenantProxyScope,
} from "@customs/shared-constants";

export type VerifiedProxyContext = {
  proxyId: string;
  tenantId: string;
  tenantScope?: TenantProxyScope;
  proxyIp: string | null;
};

export const verifiedProxyContextKey = createContextKey<
  VerifiedProxyContext | undefined
>(undefined, {
  description: "verified proxy auth context",
});

export function requireVerifiedProxyContext(
  ctx: HandlerContext,
): VerifiedProxyContext {
  const verified = ctx.values.get(verifiedProxyContextKey);
  if (!verified) {
    throw new ConnectError("invalid_proxy_token", Code.Unauthenticated);
  }
  return verified;
}

export function proxyAllowsTenant(
  proxy: Pick<VerifiedProxyContext, "tenantId" | "tenantScope">,
  tenantId: string,
): boolean {
  return (
    proxy.tenantScope === TENANT_PROXY_SCOPE.ALL_TENANTS ||
    tenantId === proxy.tenantId
  );
}
