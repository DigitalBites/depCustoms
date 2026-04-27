import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getAuthContext, requireProjectAccess } from "../../http/guards.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";
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
    const accessResult = await requireProjectAccess(c, {
      hideForbiddenAsNotFound: true,
    });
    if (!accessResult.ok) return accessResult.response;
    const access = accessResult.value;

    const { projectId } = access;
    const { tenantId, userId, role } = getAuthContext(c);
    const { name, expires_at } = c.req.valid("json");

    if (!canCreateProjectToken(role)) {
      return errorJson(
        c,
        403,
        "FORBIDDEN",
        "Access denied to create project tokens",
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
  const accessResult = await requireProjectAccess(c, {
    hideForbiddenAsNotFound: true,
  });
  if (!accessResult.ok) return accessResult.response;
  const access = accessResult.value;

  const { projectId } = access;
  const { role, userId } = getAuthContext(c);
  const { canReadAll, canReadOwn } = canReadProjectTokens(role);

  if (!canReadAll && !canReadOwn) {
    return errorJson(
      c,
      403,
      "FORBIDDEN",
      "Access denied to project tokens",
    );
  }

  const tokens = await listProjectTokens({ projectId, userId, canReadAll });
  return c.json({ tokens });
});

tokenRoutes.delete("/v1/projects/:project_id/tokens/:token_id", async (c) => {
  const accessResult = await requireProjectAccess(c, {
    hideForbiddenAsNotFound: true,
  });
  if (!accessResult.ok) return accessResult.response;
  const access = accessResult.value;

  const { projectId } = access;
  const { role, userId } = getAuthContext(c);
  const tokenIdResult = validateUuidParam(c, "token_id", "Token ID");
  if (!tokenIdResult.ok) return tokenIdResult.response;
  const tokenId = tokenIdResult.value;

  const existing = await loadExistingProjectToken(tokenId, projectId);
  if (!existing || existing.revoked_at !== null) {
    return errorJson(
      c,
      404,
      "NOT_FOUND",
      "Token not found or already revoked",
    );
  }

  if (
    !canManageExistingToken({
      role,
      action: "revoke",
      ownsToken: existing.created_by_user_id === userId,
    })
  ) {
    return errorJson(
      c,
      403,
      "FORBIDDEN",
      "Access denied to this token",
    );
  }

  const revoked = await revokeProjectToken({ tokenId, projectId, userId });
  if (!revoked) {
    return errorJson(
      c,
      404,
      "NOT_FOUND",
      "Token not found or already revoked",
    );
  }

  return c.json({ revoked: true, id: revoked.id });
});

tokenRoutes.post(
  "/v1/projects/:project_id/tokens/:token_id/rotate",
  async (c) => {
    const accessResult = await requireProjectAccess(c, {
      hideForbiddenAsNotFound: true,
    });
    if (!accessResult.ok) return accessResult.response;
    const access = accessResult.value;

    const { projectId } = access;
    const { role, tenantId, userId } = getAuthContext(c);
    const tokenIdResult = validateUuidParam(c, "token_id", "Token ID");
    if (!tokenIdResult.ok) return tokenIdResult.response;
    const tokenId = tokenIdResult.value;

    const existing = await loadRotatableProjectToken(tokenId, projectId);
    if (!existing || existing.revoked_at !== null) {
      return errorJson(
        c,
        404,
        "NOT_FOUND",
        "Token not found or already revoked",
      );
    }

    if (
      !canManageExistingToken({
        role,
        action: "rotate",
        ownsToken: existing.created_by_user_id === userId,
      })
    ) {
      return errorJson(
        c,
        403,
        "FORBIDDEN",
        "Access denied to this token",
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
