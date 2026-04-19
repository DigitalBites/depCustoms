import { Code, ConnectError, createContextKey } from "@connectrpc/connect";
import type { HandlerContext } from "@connectrpc/connect";

export type VerifiedProxyContext = {
  proxyId: string;
  tenantId: string;
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
