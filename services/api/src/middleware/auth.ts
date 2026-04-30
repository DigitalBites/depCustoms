import { createMiddleware } from "hono/factory";
import { config } from "../config.js";
import { errorJson } from "../http/responses.js";
import {
  type TenantInfo,
  parseAccessTokenClaimsFromPayload,
} from "../auth/auth-claims.js";
import {
  JwtVerificationError,
  verifyAccessToken,
} from "../auth/jwt-verifier.js";

// Augment Hono context variable types
export type AuthContext = {
  tenantId: string;
  userId: string;
  role: string;
  tenants: TenantInfo[];
};

declare module "hono" {
  interface ContextVariableMap extends AuthContext {}
}

function allowsQueryToken(path: string): boolean {
  return (
    path === "/v1/events/stream" ||
    /^\/v1\/projects\/[^/]+\/events\/stream$/.test(path)
  );
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const queryToken = c.req.query("token");
  const queryTokenAllowed = allowsQueryToken(c.req.path);

  // ?token= query param is accepted only for EventSource (SSE), which cannot
  // send custom headers. Never log this value.
  if (queryToken && !queryTokenAllowed) {
    return errorJson(
      c,
      400,
      "QUERY_TOKEN_NOT_ALLOWED",
      "Query-string tokens are only supported for SSE endpoints",
    );
  }

  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : queryTokenAllowed
      ? (queryToken ?? "")
      : "";

  if (!token) {
    return errorJson(
      c,
      401,
      "MISSING_TOKEN",
      "Authorization header with Bearer token is required",
    );
  }

  // -------------------------------------------------------------------------
  // GoTrue JWT validation — validate token directly against GoTrue /user
  // -------------------------------------------------------------------------
  if (!config.gotrueUrl) {
    return errorJson(
      c,
      500,
      "SERVER_MISCONFIGURED",
      "Authentication is not configured on this server",
      "GOTRUE_URL is required",
    );
  }

  try {
    const payload = await verifyAccessToken(token, "authenticated");
    const claims = parseAccessTokenClaimsFromPayload(payload);
    if (!claims) {
      return errorJson(
        c,
        401,
        "NO_TENANT",
        "User is not associated with a tenant",
      );
    }

    c.set("tenantId", claims.tenantId);
    c.set("userId", payload.sub);
    c.set("role", claims.role);
    c.set("tenants", claims.tenants);

    await next();
    return;
  } catch (err) {
    if (err instanceof JwtVerificationError && err.kind === "misconfigured") {
      return errorJson(
        c,
        500,
        "SERVER_MISCONFIGURED",
        "Authentication is not configured on this server",
        "AUTH_URL or GOTRUE_URL is required",
      );
    }

    if (err instanceof JwtVerificationError && err.kind === "unavailable") {
      return errorJson(
        c,
        503,
        "AUTH_UNAVAILABLE",
        "Authentication service is temporarily unavailable",
      );
    }
    return errorJson(
      c,
      401,
      "INVALID_TOKEN",
      "Token is invalid or has expired",
    );
  }
});
