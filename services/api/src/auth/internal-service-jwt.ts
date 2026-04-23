import { randomUUID } from "node:crypto";
import {
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload,
  SignJWT,
} from "jose";
import { config } from "../config.js";

const ISSUER = "customs-control-plane";
const PRIVATE_JWK_FIELDS = new Set([
  "d",
  "p",
  "q",
  "dp",
  "dq",
  "qi",
  "oth",
  "k",
  "key_ops",
]);

export type InternalServiceClaims = {
  service: string;
  tenantId?: string;
  projectId?: string;
  scope?: string[];
  subject: string;
  audience: string;
  claims?: Record<string, unknown>;
};

export type VerifiedInternalServiceJwtClaims = {
  subject: string;
  audience: string | string[];
  service: string;
  jti: string;
  expiresAt: Date;
  tenantId?: string;
  projectId?: string;
  scope: string[];
  claims: JWTPayload;
};

function parsePrivateJwk(): JWK {
  return JSON.parse(config.internalServiceJwtPrivateJwk) as JWK;
}

function publicJwkFromPrivate(jwk: JWK): JWK {
  return Object.fromEntries(
    Object.entries(jwk).filter(([key]) => !PRIVATE_JWK_FIELDS.has(key)),
  ) as JWK;
}

function signingJwkFromConfig(jwk: JWK): JWK {
  const importableJwk = { ...jwk };
  delete (importableJwk as { key_ops?: unknown }).key_ops;
  return importableJwk;
}

function resolveAlgorithm(jwk: JWK): string {
  if (typeof jwk.alg === "string" && jwk.alg !== "") {
    return jwk.alg;
  }
  if (jwk.kty === "RSA") return "RS256";
  if (jwk.kty === "EC") return "ES256";
  if (jwk.kty === "OKP") return "EdDSA";
  throw new Error("unsupported_internal_service_jwk");
}

async function resolveSigningKey(): Promise<{
  key: Awaited<ReturnType<typeof importJWK>>;
  alg: string;
  kid?: string;
}> {
  const privateJwk = parsePrivateJwk();
  return {
    key: await importJWK(signingJwkFromConfig(privateJwk), resolveAlgorithm(privateJwk)),
    alg: resolveAlgorithm(privateJwk),
    kid: config.internalServiceJwtKeyId,
  };
}

async function resolveVerificationKey(): Promise<
  Awaited<ReturnType<typeof importJWK>>
> {
  const privateJwk = parsePrivateJwk();
  const publicJwk = publicJwkFromPrivate(privateJwk);
  return importJWK(publicJwk, resolveAlgorithm(privateJwk));
}

export function getInternalServiceJwks():
  {
    keys: JWK[];
  } {
  const privateJwk = parsePrivateJwk();
  const publicJwk = publicJwkFromPrivate(privateJwk);
  return {
    keys: [
      {
        ...publicJwk,
        use: "sig",
        kid: config.internalServiceJwtKeyId,
        alg: resolveAlgorithm(privateJwk),
      },
    ],
  };
}

export async function issueInternalServiceRuntimeToken(
  input: InternalServiceClaims,
): Promise<{
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
  const signing = await resolveSigningKey();
  const payload: Record<string, unknown> = {
    service: input.service,
    ...(input.tenantId ? { tenant_id: input.tenantId } : {}),
    ...(input.projectId ? { project_id: input.projectId } : {}),
    ...(input.scope && input.scope.length > 0 ? { scope: input.scope } : {}),
    ...(input.claims ?? {}),
  };

  const jwt = new SignJWT(payload)
    .setProtectedHeader({
      alg: signing.alg,
      ...(signing.kid ? { kid: signing.kid } : {}),
    })
    .setIssuedAt(now)
    .setIssuer(ISSUER)
    .setAudience(input.audience)
    .setSubject(input.subject)
    .setJti(randomUUID())
    .setExpirationTime(expiresAt);

  const accessToken = await jwt.sign(signing.key);

  return {
    accessToken,
    expiresAt,
    refreshAfter,
  };
}

export async function verifyInternalServiceRuntimeToken(
  token: string,
  audience: string,
): Promise<VerifiedInternalServiceJwtClaims> {
  const verificationKey = await resolveVerificationKey();
  const algorithms = [resolveAlgorithm(parsePrivateJwk())];
  const { payload } = await jwtVerify(token, verificationKey, {
    issuer: ISSUER,
    audience,
    algorithms,
  });

  if (
    typeof payload.sub !== "string" ||
    typeof payload.service !== "string" ||
    typeof payload.jti !== "string" ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("internal_service_jwt_missing_claims");
  }

  return {
    subject: payload.sub,
    audience: payload.aud ?? audience,
    service: payload.service,
    jti: payload.jti,
    expiresAt: new Date(payload.exp * 1000),
    tenantId:
      typeof payload.tenant_id === "string" ? payload.tenant_id : undefined,
    projectId:
      typeof payload.project_id === "string" ? payload.project_id : undefined,
    scope: Array.isArray(payload.scope)
      ? payload.scope.filter((value): value is string => typeof value === "string")
      : [],
    claims: payload,
  };
}
