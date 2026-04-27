/**
 * Internal routes — not user-facing, not behind authMiddleware.
 *
 * POST /internal/auth/token-hook
 *   Called synchronously by GoTrue on every sign-in via the
 *   custom_access_token hook. Stamps tenant_id, role, and the full tenants
 *   array from the memberships table into the JWT claims before GoTrue
 *   issues the token.
 *
 *   Multi-tenant users: all memberships are embedded as app_metadata.tenants.
 *   The active tenant is resolved from preferred_tenant_id (stored in
 *   app_metadata by POST /v1/auth/preferred-tenant) if valid, otherwise the
 *   first membership row is used. The dashboard redirects multi-tenant users
 *   to /auth/select-tenant after login so they can pick their active tenant.
 *
 *   GoTrue uses the Standard Webhooks spec (standardwebhooks.com):
 *     - Header:  webhook-signature: v1,<base64-HMAC-SHA256>
 *     - Signed:  <webhook-id>.<webhook-timestamp>.<raw-body>
 *     - Secret:  base64-decoded bytes from GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS
 *
 *   GOTRUE_HOOK_SECRET in .env.local must equal the plaintext value that was
 *   base64-encoded into the whsec_ part of GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS.
 */

import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getBootstrapStatus } from "../bootstrap/status-service.js";
import { config } from "../config.js";
import { log } from "../logger.js";
import { errorJson, errorResult, okResult } from "../http/responses.js";
import {
  AuthAdminServiceError,
  authAdminService,
} from "../auth/admin-service.js";
import { isGotrueDependencyError } from "../auth/gotrue-client.js";
import {
  buildTokenHookClaims,
  parseTokenHookPayload,
} from "../features/internal-auth-hook/token-hook-service.js";
import { verifyTokenHookRequest } from "../features/internal-auth-hook/verification.js";
import { exchangeProxyRuntimeToken } from "../features/internal-proxy-auth/token-exchange-service.js";

export const internalRouter = new Hono();
const bootstrapFirstUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});
const proxyTokenHeaderSchema = z.object({
  proxyId: z.string().uuid(),
  proxySecret: z.string().min(1).max(512),
  proxyIp: z.string().max(255).nullable(),
});
const tokenHookHeaderSchema = z.object({
  webhookId: z.string().min(1).max(255),
  webhookTimestamp: z.string().regex(/^\d+$/),
  webhookSignature: z.string().min(1).max(4096),
});

function parseProxyTokenHeaders(c: Context) {
  const parsed = proxyTokenHeaderSchema.safeParse({
    proxyId: c.req.header("x-proxy-id"),
    proxySecret: c.req.header("x-proxy-secret"),
    proxyIp: c.req.header("x-proxy-remote-addr") ?? null,
  });

  if (!parsed.success) {
    return errorResult(
      c,
      400,
      "BAD_REQUEST",
      "Proxy authentication headers are invalid",
      null,
    );
  }

  return okResult(parsed.data);
}

function parseTokenHookHeaders(c: Context) {
  const parsed = tokenHookHeaderSchema.safeParse({
    webhookId: c.req.header("webhook-id"),
    webhookTimestamp: c.req.header("webhook-timestamp"),
    webhookSignature: c.req.header("webhook-signature"),
  });

  if (!parsed.success) {
    return errorResult(
      c,
      401,
      "UNAUTHORIZED",
      "Token hook headers are invalid",
      null,
    );
  }

  return okResult(parsed.data);
}

internalRouter.get("/internal/bootstrap/status", async (c) => {
  const status = await getBootstrapStatus();
  const httpStatus =
    status.state === "ready" ||
    status.state === "no_users" ||
    status.state === "needs_setup"
      ? 200
      : 503;
  return c.json(status, httpStatus);
});

internalRouter.post(
  "/internal/bootstrap/first-user",
  zValidator("json", bootstrapFirstUserSchema),
  async (c) => {
    const status = await getBootstrapStatus();
    if (!status.checks.authReachable) {
      return errorJson(
        c,
        503,
        "AUTH_UNAVAILABLE",
        "Authentication service is temporarily unavailable",
        "Bootstrap cannot create the first user until auth is reachable",
      );
    }

    if (status.checks.usersExist) {
      return errorJson(
        c,
        409,
        "BOOTSTRAP_USER_ALREADY_EXISTS",
        "The first user has already been created",
        null,
      );
    }

    const payload = c.req.valid("json");

    try {
      const user = await authAdminService.createUser(
        payload.email,
        payload.password,
      );
      log.info("bootstrap_first_user_created", {
        user_id: typeof user.id === "string" ? user.id : null,
        email: payload.email,
      });
      return c.json(
        {
          user: {
            id: typeof user.id === "string" ? user.id : null,
            email: user.email ?? payload.email,
          },
        },
        201,
      );
    } catch (err) {
      if (err instanceof AuthAdminServiceError) {
        const statusCode =
          err.kind === "misconfigured"
            ? 500
            : err.status && err.status >= 400 && err.status < 500
              ? err.status
              : 502;
        return errorJson(
          c,
          statusCode,
          "BOOTSTRAP_FIRST_USER_FAILED",
          "Unable to create the first user",
          err.detail ?? err.message,
        );
      }

      if (isGotrueDependencyError(err)) {
        return errorJson(
          c,
          503,
          "AUTH_UNAVAILABLE",
          "Authentication service is temporarily unavailable",
          "Bootstrap cannot create the first user until auth is reachable",
        );
      }

      throw err;
    }
  },
);

internalRouter.post("/internal/v1/proxy/token", async (c) => {
  const headers = parseProxyTokenHeaders(c);
  if (!headers.ok) return headers.response;

  const result = await exchangeProxyRuntimeToken({
    proxyId: headers.value.proxyId,
    proxySecret: headers.value.proxySecret,
    proxyIp: headers.value.proxyIp,
  });

  if (!result.ok) {
    return errorJson(
      c,
      result.status,
      result.code,
      result.message,
      result.detail,
    );
  }

  return c.json({
    access_token: result.accessToken,
    expires_at: result.expiresAt.toISOString(),
    refresh_after: result.refreshAfter.toISOString(),
  });
});

internalRouter.post("/internal/auth/token-hook", async (c) => {
  const secret = config.gotrueHookSecret;
  if (!secret) {
    log.error("token_hook_misconfigured", {
      message: "GOTRUE_HOOK_SECRET is not set — token hook is unconfigured",
    });
    return errorJson(
      c,
      500,
      "SERVER_MISCONFIGURED",
      "Hook secret not configured",
    );
  }

  // -------------------------------------------------------------------------
  // Verify GoTrue webhook signature (Standard Webhooks spec).
  // -------------------------------------------------------------------------
  const body = await c.req.text();
  const headers = parseTokenHookHeaders(c);
  if (!headers.ok) return headers.response;

  const verification = verifyTokenHookRequest({
    secret,
    body,
    webhookId: headers.value.webhookId,
    webhookTimestamp: headers.value.webhookTimestamp,
    webhookSignature: headers.value.webhookSignature,
  });

  if (!verification.ok) {
    return errorJson(
      c,
      verification.status,
      verification.code,
      verification.message,
    );
  }

  // -------------------------------------------------------------------------
  // Parse payload
  // -------------------------------------------------------------------------
  let payload: { user_id: string; claims?: Record<string, unknown> };
  try {
    payload = parseTokenHookPayload(body);
  } catch {
    return errorJson(
      c,
      400,
      "BAD_REQUEST",
      "Invalid JSON payload",
    );
  }

  const claims = await buildTokenHookClaims(payload);
  const audiences = Array.isArray(claims.aud)
    ? claims.aud.filter((value): value is string => typeof value === "string")
    : typeof claims.aud === "string"
      ? [claims.aud]
      : [];
  const appMetadata =
    claims.app_metadata && typeof claims.app_metadata === "object"
      ? (claims.app_metadata as Record<string, unknown>)
      : null;

  log.info("token_hook_claims_built", {
    user_id: payload.user_id,
    tenant_id:
      typeof claims.tenant_id === "string"
        ? claims.tenant_id
        : typeof appMetadata?.tenant_id === "string"
          ? appMetadata.tenant_id
          : null,
    role: typeof appMetadata?.role === "string" ? appMetadata.role : null,
    client_id: typeof claims.client_id === "string" ? claims.client_id : null,
    mcp_audience_granted: audiences.includes("mcp"),
    audiences,
  });

  return c.json({ claims });
});
