import {
  issueInternalServiceRuntimeToken,
  verifyInternalServiceRuntimeToken,
} from "./internal-service-jwt.js";

const audience = "customs-proxy-rpc";

export type VerifiedProxyJwtClaims = {
  proxyId: string;
  tenantId: string;
  jti: string;
  expiresAt: Date;
};

export async function issueProxyRuntimeToken(input: {
  proxyId: string;
  tenantId: string;
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
    jti: claims.jti,
    expiresAt: claims.expiresAt,
  };
}
