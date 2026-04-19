import { createMiddleware } from "hono/factory";
import { config } from "../config.js";
import {
  InvalidAuthClaimsError,
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
    return c.json(
      {
        error: {
          code: "QUERY_TOKEN_NOT_ALLOWED",
          message: "Query-string tokens are only supported for SSE endpoints",
          detail: null,
        },
      },
      400,
    );
  }

  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : queryTokenAllowed
      ? (queryToken ?? "")
      : "";

  if (!token) {
    return c.json(
      {
        error: {
          code: "MISSING_TOKEN",
          message: "Authorization header with Bearer token is required",
          detail: null,
        },
      },
      401,
    );
  }

  // -------------------------------------------------------------------------
  // GoTrue JWT validation — validate token directly against GoTrue /user
  // -------------------------------------------------------------------------
  if (!config.gotrueUrl) {
    return c.json(
      {
        error: {
          code: "SERVER_MISCONFIGURED",
          message: "Authentication is not configured on this server",
          detail: "GOTRUE_URL is required",
        },
      },
      500,
    );
  }

  try {
    const payload = await verifyAccessToken(token, "authenticated");
    const claims = parseAccessTokenClaimsFromPayload(payload);
    if (!claims) {
      return c.json(
        {
          error: {
            code: "NO_TENANT",
            message: "User is not associated with a tenant",
            detail: null,
          },
        },
        401,
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
      return c.json(
        {
          error: {
            code: "SERVER_MISCONFIGURED",
            message: "Authentication is not configured on this server",
            detail: "AUTH_URL or GOTRUE_URL is required",
          },
        },
        500,
      );
    }

    if (err instanceof JwtVerificationError && err.kind === "unavailable") {
      return c.json(
        {
          error: {
            code: "AUTH_UNAVAILABLE",
            message: "Authentication service is temporarily unavailable",
            detail: null,
          },
        },
        503,
      );
    }
    return c.json(
      {
        error: {
          code:
            err instanceof InvalidAuthClaimsError
              ? "INVALID_TOKEN"
              : "INVALID_TOKEN",
          message: "Token is invalid or has expired",
          detail: null,
        },
      },
      401,
    );
  }
});
