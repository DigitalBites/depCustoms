import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getAuthContext, requireProjectAccess } from "../../http/guards.js";
import { validateUuidParam } from "../../http/responses.js";
import {
  canCreateProjectToken,
  canManageExistingToken,
  canReadProjectTokens,
  createProjectToken,
  listProjectTokens,
  loadExistingProjectToken,
  loadRotatableProjectToken,
  revokeProjectToken,
  rotateProjectToken,
} from "./service.js";

export const tokenRoutes = new Hono();

const createTokenSchema = z.object({
  name: z.string().min(1).max(255),
  expires_at: z.string().datetime({ offset: true }).optional(),
});

tokenRoutes.post(
  "/v1/projects/:project_id/tokens",
  zValidator("json", createTokenSchema),
  async (c) => {
    const access = await requireProjectAccess(c, {
      hideForbiddenAsNotFound: true,
    });
    if (!access) return c.res;

    const { projectId } = access;
    const { tenantId, userId, role } = getAuthContext(c);
    const { name, expires_at } = c.req.valid("json");

    if (!canCreateProjectToken(role)) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Access denied to create project tokens",
            detail: null,
          },
        },
        403,
      );
    }

    const token = await createProjectToken({
      projectId,
      tenantId,
      userId,
      name,
      expiresAt: expires_at ? new Date(expires_at) : null,
    });

    return c.json(token, 201);
  },
);

tokenRoutes.get("/v1/projects/:project_id/tokens", async (c) => {
  const access = await requireProjectAccess(c, {
    hideForbiddenAsNotFound: true,
  });
  if (!access) return c.res;

  const { projectId } = access;
  const { role, userId } = getAuthContext(c);
  const { canReadAll, canReadOwn } = canReadProjectTokens(role);

  if (!canReadAll && !canReadOwn) {
    return c.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Access denied to project tokens",
          detail: null,
        },
      },
      403,
    );
  }

  const tokens = await listProjectTokens({ projectId, userId, canReadAll });
  return c.json({ tokens });
});

tokenRoutes.delete("/v1/projects/:project_id/tokens/:token_id", async (c) => {
  const access = await requireProjectAccess(c, {
    hideForbiddenAsNotFound: true,
  });
  if (!access) return c.res;

  const { projectId } = access;
  const { role, userId } = getAuthContext(c);
  const tokenId = validateUuidParam(c, "token_id", "Token ID");
  if (!tokenId) return c.res;

  const existing = await loadExistingProjectToken(tokenId, projectId);
  if (!existing || existing.revoked_at !== null) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Token not found or already revoked",
          detail: null,
        },
      },
      404,
    );
  }

  if (
    !canManageExistingToken({
      role,
      action: "revoke",
      ownsToken: existing.created_by_user_id === userId,
    })
  ) {
    return c.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Access denied to this token",
          detail: null,
        },
      },
      403,
    );
  }

  const revoked = await revokeProjectToken({ tokenId, projectId, userId });
  if (!revoked) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Token not found or already revoked",
          detail: null,
        },
      },
      404,
    );
  }

  return c.json({ revoked: true, id: revoked.id });
});

tokenRoutes.post(
  "/v1/projects/:project_id/tokens/:token_id/rotate",
  async (c) => {
    const access = await requireProjectAccess(c, {
      hideForbiddenAsNotFound: true,
    });
    if (!access) return c.res;

    const { projectId } = access;
    const { role, tenantId, userId } = getAuthContext(c);
    const tokenId = validateUuidParam(c, "token_id", "Token ID");
    if (!tokenId) return c.res;

    const existing = await loadRotatableProjectToken(tokenId, projectId);
    if (!existing || existing.revoked_at !== null) {
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Token not found or already revoked",
            detail: null,
          },
        },
        404,
      );
    }

    if (
      !canManageExistingToken({
        role,
        action: "rotate",
        ownsToken: existing.created_by_user_id === userId,
      })
    ) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Access denied to this token",
            detail: null,
          },
        },
        403,
      );
    }

    const rotated = await rotateProjectToken({
      tokenId,
      projectId,
      tenantId,
      userId,
      existing,
    });

    return c.json(rotated);
  },
);
