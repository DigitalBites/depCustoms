import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { config } from "../config.js";

const issuer = "customs-control-plane";
const audience = "customs-proxy-rpc";
const encoder = new TextEncoder();

export type VerifiedProxyJwtClaims = {
  proxyId: string;
  tenantId: string;
  jti: string;
  expiresAt: Date;
};

function signingKey(): Uint8Array {
  return encoder.encode(config.proxyJwtSecret);
}

export async function issueProxyRuntimeToken(input: {
  proxyId: string;
  tenantId: string;
}): Promise<{
  accessToken: string;
  expiresAt: Date;
  refreshAfter: Date;
}> {
  const now = new Date();
  const ttlSeconds = config.proxyJwtTtlSeconds;
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const refreshAfter = new Date(
    now.getTime() + Math.floor(ttlSeconds * 0.8) * 1000,
  );

  const accessToken = await new SignJWT({
    proxy_id: input.proxyId,
    tenant_id: input.tenantId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(input.proxyId)
    .setJti(randomUUID())
    .setExpirationTime(expiresAt)
    .sign(signingKey());

  return {
    accessToken,
    expiresAt,
    refreshAfter,
  };
}

export async function verifyProxyRuntimeToken(
  token: string,
): Promise<VerifiedProxyJwtClaims> {
  const { payload } = await jwtVerify(token, signingKey(), {
    issuer,
    audience,
    algorithms: ["HS256"],
  });

  if (
    typeof payload.sub !== "string" ||
    typeof payload.proxy_id !== "string" ||
    typeof payload.tenant_id !== "string" ||
    typeof payload.jti !== "string" ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("proxy_jwt_missing_claims");
  }

  return {
    proxyId: payload.proxy_id,
    tenantId: payload.tenant_id,
    jti: payload.jti,
    expiresAt: new Date(payload.exp * 1000),
  };
}
