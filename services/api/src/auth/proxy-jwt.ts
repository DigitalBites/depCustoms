import {
  issueInternalServiceRuntimeToken,
  verifyInternalServiceRuntimeToken,
} from "./internal-service-jwt.js";
import {
  TENANT_PROXY_SCOPE,
  type TenantProxyScope,
} from "@customs/shared-constants";

const audience = "customs-proxy-rpc";

export type VerifiedProxyJwtClaims = {
  proxyId: string;
  tenantId: string;
  tenantScope: TenantProxyScope;
  jti: string;
  expiresAt: Date;
};

export async function issueProxyRuntimeToken(input: {
  proxyId: string;
  tenantId: string;
  tenantScope?: TenantProxyScope;
}): Promise<{
  accessToken: string;
  expiresAt: Date;
  refreshAfter: Date;
}> {
  return issueInternalServiceRuntimeToken({
    service: "proxy",
    subject: input.proxyId,
    audience,
    tenantId: input.tenantId,
    claims: {
      proxy_id: input.proxyId,
      tenant_scope: input.tenantScope ?? TENANT_PROXY_SCOPE.OWNER_ONLY,
    },
  });
}

export async function verifyProxyRuntimeToken(
  token: string,
): Promise<VerifiedProxyJwtClaims> {
  const claims = await verifyInternalServiceRuntimeToken(token, audience);
  if (
    claims.service !== "proxy" ||
    typeof claims.claims.proxy_id !== "string" ||
    typeof claims.tenantId !== "string"
  ) {
    throw new Error("proxy_jwt_missing_claims");
  }

  return {
    proxyId: claims.claims.proxy_id,
    tenantId: claims.tenantId,
    tenantScope: parseTenantScope(claims.claims.tenant_scope),
    jti: claims.jti,
    expiresAt: claims.expiresAt,
  };
}

function parseTenantScope(value: unknown): TenantProxyScope {
  return value === TENANT_PROXY_SCOPE.ALL_TENANTS
    ? TENANT_PROXY_SCOPE.ALL_TENANTS
    : TENANT_PROXY_SCOPE.OWNER_ONLY;
}
