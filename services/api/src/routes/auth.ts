/**
 * Auth routes — tenant preference management.
 *
 * POST /v1/auth/preferred-tenant
 *   Sets the user's preferred (active) tenant. The dashboard calls this when
 *   a multi-tenant user picks a tenant from the /auth/select-tenant page or
 *   switches via the sidebar tenant switcher.
 *
 *   Flow:
 *     1. Validate the requested tenant_id is present in the current session claims.
 *     2. Store preferred_tenant_id in Supabase user app_metadata via service role.
 *     3. Client calls supabase.auth.refreshSession() to re-issue the JWT.
 *     4. The token hook reads preferred_tenant_id and stamps the correct tenant.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { errorJson } from "../http/responses.js";
import {
  AuthAdminServiceError,
  authAdminService,
} from "../auth/admin-service.js";

export const authRouter = new Hono();

authRouter.use("*", authMiddleware);

// POST /v1/auth/preferred-tenant
authRouter.post(
  "/v1/auth/preferred-tenant",
  zValidator("json", z.object({ tenant_id: z.string().uuid() })),
  async (c) => {
    const { tenant_id } = c.req.valid("json");
    const userId = c.get("userId");
    const tenants = c.get("tenants");
    const valid = tenants.some((tenant) => tenant.tenant_id === tenant_id);

    if (!valid) {
      return errorJson(
        c,
        403,
        "FORBIDDEN",
        "You are not a member of that tenant",
      );
    }

    try {
      await authAdminService.updateUser(userId, {
        app_metadata: { preferred_tenant_id: tenant_id },
      });
    } catch (err) {
      if (
        err instanceof AuthAdminServiceError &&
        err.kind === "misconfigured"
      ) {
        return errorJson(
          c,
          500,
          "SERVER_MISCONFIGURED",
          "Service is not configured",
        );
      }

      return errorJson(
        c,
        500,
        "UPDATE_FAILED",
        "Failed to update tenant preference",
      );
    }

    return c.json({ ok: true });
  },
);
