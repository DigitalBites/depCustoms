import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";
import { config } from "../config.js";

const verifiedJwtPayloadSchema = z.object({
  sub: z.string().uuid(),
});

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function resolveJwksUrl(): string {
  if (config.gotrueUrl) {
    return `${stripTrailingSlash(config.gotrueUrl)}/.well-known/jwks.json`;
  }

  if (config.authUrl) {
    return `${stripTrailingSlash(config.authUrl)}/auth/v1/.well-known/jwks.json`;
  }

  throw new Error("Auth service is not configured");
}

function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(resolveJwksUrl()));
  }
  return jwks;
}

export class JwtVerificationError extends Error {
  readonly kind: "misconfigured" | "invalid" | "expired" | "unavailable";

  constructor(
    kind: "misconfigured" | "invalid" | "expired" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "JwtVerificationError";
    this.kind = kind;
  }
}

function normalizeJwtVerificationError(err: unknown): JwtVerificationError {
  if (err instanceof JwtVerificationError) {
    return err;
  }

  if (
    err instanceof TypeError ||
    err instanceof errors.JWKSNoMatchingKey ||
    err instanceof errors.JWSSignatureVerificationFailed ||
    err instanceof errors.JWTClaimValidationFailed ||
    err instanceof errors.JWSInvalid ||
    err instanceof errors.JWTInvalid
  ) {
    if (err instanceof errors.JWTExpired) {
      return new JwtVerificationError("expired", err.message);
    }
    return new JwtVerificationError("invalid", err.message);
  }

  if (err instanceof errors.JOSEError) {
    return new JwtVerificationError("invalid", err.message);
  }

  if (err instanceof Error) {
    return new JwtVerificationError("unavailable", err.message);
  }

  return new JwtVerificationError("unavailable", String(err));
}

function validateVerifiedPayload(
  payload: JWTPayload,
): JWTPayload & { sub: string } {
  const parsed = verifiedJwtPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new JwtVerificationError("invalid", "Token user id is invalid");
  }

  return {
    ...payload,
    sub: parsed.data.sub,
  };
}

export async function verifyAccessToken(
  token: string,
  audience: string,
): Promise<JWTPayload & { sub: string }> {
  if (!config.authUrl && !config.gotrueUrl) {
    throw new JwtVerificationError(
      "misconfigured",
      "Authentication is not configured on this server",
    );
  }

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      audience,
    });
    return validateVerifiedPayload(payload);
  } catch (err) {
    throw normalizeJwtVerificationError(err);
  }
}
