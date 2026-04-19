import { z } from "zod";
import {
  InvalidAuthClaimsError,
  parseMcpAccessTokenClaimsFromPayload,
} from "../../../auth/auth-claims.js";
import { config } from "../../../config.js";
import { canPerform, isTenantRole } from "../../../middleware/rbac.js";
import type { McpPrincipal } from "../context.js";
import {
  JwtVerificationError,
  verifyAccessToken,
} from "../../../auth/jwt-verifier.js";

export class McpAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "McpAuthError";
  }
}

function extractBearerToken(authHeader: string | undefined): string {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new McpAuthError(
      401,
      "MISSING_TOKEN",
      "Authorization header with Bearer token is required",
    );
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new McpAuthError(
      401,
      "MISSING_TOKEN",
      "Authorization header with Bearer token is required",
    );
  }

  return token;
}

const uuidSchema = z.string().uuid();

export async function resolveMcpPrincipalFromAuthorizationHeader(
  authHeader: string | undefined,
): Promise<McpPrincipal> {
  const token = extractBearerToken(authHeader);

  if (!config.authUrl && !config.gotrueUrl) {
    throw new McpAuthError(
      500,
      "SERVER_MISCONFIGURED",
      "Authentication is not configured on this server",
    );
  }

  let payload;
  try {
    payload = await verifyAccessToken(token, "mcp");
  } catch (err) {
    if (err instanceof JwtVerificationError && err.kind === "misconfigured") {
      throw new McpAuthError(
        500,
        "SERVER_MISCONFIGURED",
        "Authentication is not configured on this server",
      );
    }

    if (err instanceof JwtVerificationError && err.kind === "unavailable") {
      throw new McpAuthError(
        503,
        "AUTH_UNAVAILABLE",
        "Authentication service is temporarily unavailable",
      );
    }

    throw new McpAuthError(
      401,
      "INVALID_TOKEN",
      "Token is invalid or has expired",
    );
  }

  let claims;
  try {
    claims = parseMcpAccessTokenClaimsFromPayload(payload);
  } catch (err) {
    if (err instanceof InvalidAuthClaimsError) {
      throw new McpAuthError(
        401,
        "INVALID_TOKEN",
        "Token is invalid or has expired",
      );
    }
    throw err;
  }

  if (!claims) {
    throw new McpAuthError(
      401,
      "NO_TENANT",
      "User is not associated with a tenant",
    );
  }

  if (!claims.audiences.includes("mcp")) {
    throw new McpAuthError(
      403,
      "INVALID_AUDIENCE",
      "Token is not authorized for MCP access",
    );
  }

  if (!isTenantRole(claims.role)) {
    throw new McpAuthError(401, "INVALID_TOKEN", "Token role is invalid");
  }

  if (!canPerform(claims.role, "mcp.read")) {
    throw new McpAuthError(
      403,
      "FORBIDDEN",
      `Users with role "${claims.role}" cannot use MCP`,
    );
  }

  if (!uuidSchema.safeParse(payload.sub).success) {
    throw new McpAuthError(401, "INVALID_TOKEN", "Token user id is invalid");
  }

  return {
    userId: payload.sub,
    tenantId: claims.tenantId,
    role: claims.role,
    tenants: claims.tenants,
    audiences: claims.audiences,
    clientId: claims.clientId,
    sessionId: claims.sessionId,
  };
}
