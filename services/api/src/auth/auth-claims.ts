import { z } from "zod";
import { isTenantRole, type TenantRole } from "../middleware/rbac.js";

const tenantRoleSchema = z.custom<TenantRole>(
  (value) => typeof value === "string" && isTenantRole(value),
  "Invalid tenant role",
);

const tenantInfoSchema = z.object({
  tenant_id: z.string().uuid(),
  tenant_name: z.string().min(1),
  role: tenantRoleSchema,
});

const appMetadataSchema = z.object({
  tenant_id: z.string().uuid(),
  role: tenantRoleSchema,
  tenants: z.array(tenantInfoSchema).default([]),
});

export type TenantInfo = z.infer<typeof tenantInfoSchema>;

export type AuthClaims = {
  tenantId: string;
  role: TenantRole;
  tenants: TenantInfo[];
};

export type McpAccessTokenClaims = AuthClaims & {
  audiences: string[];
  clientId: string | null;
  sessionId: string | null;
};

export class InvalidAuthClaimsError extends Error {
  constructor(message = "Invalid auth claims") {
    super(message);
    this.name = "InvalidAuthClaimsError";
  }
}

const jwtPayloadSchema = z.object({
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  app_metadata: z.unknown().optional(),
  client_id: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
});

function decodeJwtPayload(token: string): unknown {
  const segments = token.split(".");
  if (segments.length < 2 || !segments[1]) {
    throw new InvalidAuthClaimsError("JWT payload segment is missing");
  }

  try {
    return JSON.parse(Buffer.from(segments[1], "base64url").toString());
  } catch {
    throw new InvalidAuthClaimsError("JWT payload is not valid JSON");
  }
}

function parseBaseClaims(payload: unknown): AuthClaims | null {
  const appMetadata = (payload as { app_metadata?: unknown } | null)
    ?.app_metadata;
  if (
    !appMetadata ||
    typeof appMetadata !== "object" ||
    typeof (appMetadata as { tenant_id?: unknown }).tenant_id !== "string"
  ) {
    return null;
  }

  const parsed = appMetadataSchema.safeParse(appMetadata);
  if (!parsed.success) {
    throw new InvalidAuthClaimsError("JWT app_metadata claims are invalid");
  }

  return {
    tenantId: parsed.data.tenant_id,
    role: parsed.data.role,
    tenants: parsed.data.tenants,
  };
}

export function parseAccessTokenClaims(token: string): AuthClaims | null {
  return parseBaseClaims(decodeJwtPayload(token));
}

export function parseAccessTokenClaimsFromPayload(
  payload: unknown,
): AuthClaims | null {
  return parseBaseClaims(payload);
}

export function parseMcpAccessTokenClaims(
  token: string,
): McpAccessTokenClaims | null {
  const payload = decodeJwtPayload(token);
  return parseMcpAccessTokenClaimsFromPayload(payload);
}

export function parseMcpAccessTokenClaimsFromPayload(
  payload: unknown,
): McpAccessTokenClaims | null {
  const parsedPayload = jwtPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    throw new InvalidAuthClaimsError("JWT payload claims are invalid");
  }

  const baseClaims = parseBaseClaims(payload);
  if (!baseClaims) {
    return null;
  }

  const audiences = Array.isArray(parsedPayload.data.aud)
    ? parsedPayload.data.aud
    : parsedPayload.data.aud
      ? [parsedPayload.data.aud]
      : [];

  return {
    ...baseClaims,
    audiences,
    clientId: parsedPayload.data.client_id ?? null,
    sessionId: parsedPayload.data.session_id ?? null,
  };
}
