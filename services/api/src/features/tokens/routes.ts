import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import { ACTOR_RESOLUTION_MODE } from "@customs/shared-constants";
import { db } from "../../db/index.js";
import { projects } from "../../db/schema.js";
import { getAuthContext } from "../../http/guards.js";
import { errorBody } from "../../http/responses.js";
import {
  errorResponseSchema,
  projectPathParamsSchema,
  projectTokenPathParamsSchema,
} from "../../openapi/schemas.js";
import { checkProjectAccess } from "../../middleware/rbac.js";
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

export const tokenRoutes = new OpenAPIHono();

const createTokenSchema = z.object({
  name: z.string().min(1).max(255),
  expires_at: z.string().datetime({ offset: true }).optional(),
});
const tokenActorSchema = z
  .object({
    user_id: z.string().uuid(),
    email: z.string().email().nullable(),
    provider: z.string().nullable(),
  })
  .nullable()
  .openapi("ProjectTokenActor");
const projectTokenSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    token_prefix: z.string(),
    created_at: z.string().datetime({ offset: true }),
    last_used_at: z.string().datetime({ offset: true }).nullable(),
    expires_at: z.string().datetime({ offset: true }).nullable(),
    revoked_at: z.string().datetime({ offset: true }).nullable(),
    owner_user_id: z.string().uuid(),
    created_by_user_id: z.string().uuid().nullable(),
    revoked_by_user_id: z.string().uuid().nullable(),
    owner: tokenActorSchema,
    created_by: tokenActorSchema,
    revoked_by: tokenActorSchema,
  })
  .openapi("ProjectToken");
const createProjectTokenResponseSchema = z
  .object({
    token: z.string(),
    id: z.string().uuid(),
    prefix: z.string(),
    expires_at: z.string().datetime({ offset: true }).nullable(),
  })
  .openapi("CreateProjectTokenResponse");
const listProjectTokensResponseSchema = z
  .object({
    tokens: z.array(projectTokenSchema),
  })
  .openapi("ListProjectTokensResponse");
const revokeProjectTokenResponseSchema = z
  .object({
    revoked: z.literal(true),
    id: z.string().uuid(),
  })
  .openapi("RevokeProjectTokenResponse");
const rotateProjectTokenResponseSchema = z
  .object({
    token: z.string(),
    id: z.string().uuid(),
    prefix: z.string(),
    expires_at: z.string().datetime({ offset: true }).nullable(),
  })
  .openapi("RotateProjectTokenResponse");
const createProjectTokenRoute = createRoute({
  method: "post",
  path: "/v1/projects/{project_id}/tokens",
  tags: ["tokens"],
  summary: "Create project token",
  security: [{ bearerAuth: [] }],
  request: {
    params: projectPathParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: createTokenSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Project token created.",
      content: {
        "application/json": {
          schema: createProjectTokenResponseSchema,
        },
      },
    },
    403: {
      description: "Caller cannot create project tokens.",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: "Project not found or not visible to the caller.",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});
const listProjectTokensRoute = createRoute({
  method: "get",
  path: "/v1/projects/{project_id}/tokens",
  tags: ["tokens"],
  summary: "List project tokens",
  security: [{ bearerAuth: [] }],
  request: {
    params: projectPathParamsSchema,
  },
  responses: {
    200: {
      description: "Project tokens visible to the caller.",
      content: {
        "application/json": {
          schema: listProjectTokensResponseSchema,
        },
      },
    },
    403: {
      description: "Caller cannot read project tokens.",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: "Project not found or not visible to the caller.",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});
const revokeProjectTokenRoute = createRoute({
  method: "delete",
  path: "/v1/projects/{project_id}/tokens/{token_id}",
  tags: ["tokens"],
  summary: "Revoke project token",
  security: [{ bearerAuth: [] }],
  request: {
    params: projectTokenPathParamsSchema,
  },
  responses: {
    200: {
      description: "Project token revoked.",
      content: {
        "application/json": {
          schema: revokeProjectTokenResponseSchema,
        },
      },
    },
    403: {
      description: "Caller cannot revoke the token.",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: "Token not found, revoked, or not visible to the caller.",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});
const rotateProjectTokenRoute = createRoute({
  method: "post",
  path: "/v1/projects/{project_id}/tokens/{token_id}/rotate",
  tags: ["tokens"],
  summary: "Rotate project token",
  security: [{ bearerAuth: [] }],
  request: {
    params: projectTokenPathParamsSchema,
  },
  responses: {
    200: {
      description: "Project token rotated.",
      content: {
        "application/json": {
          schema: rotateProjectTokenResponseSchema,
        },
      },
    },
    403: {
      description: "Caller cannot rotate the token.",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: "Token not found, revoked, or not visible to the caller.",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

tokenRoutes.openapi(createProjectTokenRoute, async (c) => {
  const { project_id: projectId } = c.req.valid("param");
  const { tenantId, userId, role } = getAuthContext(c);
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenant_id, tenantId)))
    .limit(1);
  if (!project) {
    return c.json(errorBody("NOT_FOUND", "Project not found", projectId), 404);
  }
  const hasAccess = await checkProjectAccess(userId, projectId, tenantId, role);
  if (!hasAccess) {
    return c.json(errorBody("NOT_FOUND", "Project not found", projectId), 404);
  }
  const { name, expires_at } = c.req.valid("json");

  if (!canCreateProjectToken(role)) {
    return c.json(
      errorBody(
        "FORBIDDEN",
        "Access denied to create project tokens",
        null,
      ),
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
});

tokenRoutes.openapi(listProjectTokensRoute, async (c) => {
  const { project_id: projectId } = c.req.valid("param");
  const { tenantId, userId, role } = getAuthContext(c);
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenant_id, tenantId)))
    .limit(1);
  if (!project) {
    return c.json(errorBody("NOT_FOUND", "Project not found", projectId), 404);
  }
  const hasAccess = await checkProjectAccess(userId, projectId, tenantId, role);
  if (!hasAccess) {
    return c.json(errorBody("NOT_FOUND", "Project not found", projectId), 404);
  }
  const { canReadAll, canReadOwn, canReadActorProfiles } =
    canReadProjectTokens(role);

  if (!canReadAll && !canReadOwn) {
    return c.json(
      errorBody("FORBIDDEN", "Access denied to project tokens", null),
      403,
    );
  }

  const tokens = await listProjectTokens({
    projectId,
    userId,
    canReadAll,
    actorResolutionMode: canReadActorProfiles
      ? ACTOR_RESOLUTION_MODE.WITH_PROFILE
      : ACTOR_RESOLUTION_MODE.IDS_ONLY,
  });
  return c.json({ tokens });
});

tokenRoutes.openapi(revokeProjectTokenRoute, async (c) => {
  const { project_id: projectId, token_id: tokenId } = c.req.valid("param");
  const { tenantId, userId, role } = getAuthContext(c);
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenant_id, tenantId)))
    .limit(1);
  if (!project) {
    return c.json(errorBody("NOT_FOUND", "Project not found", projectId), 404);
  }
  const hasAccess = await checkProjectAccess(userId, projectId, tenantId, role);
  if (!hasAccess) {
    return c.json(errorBody("NOT_FOUND", "Project not found", projectId), 404);
  }

  const existing = await loadExistingProjectToken(tokenId, projectId);
  if (!existing || existing.revoked_at !== null) {
    return c.json(
      errorBody("NOT_FOUND", "Token not found or already revoked", null),
      404,
    );
  }

  if (
    !canManageExistingToken({
      role,
      action: "revoke",
      ownsToken: existing.owner_user_id === userId,
    })
  ) {
    return c.json(
      errorBody("FORBIDDEN", "Access denied to this token", null),
      403,
    );
  }

  const revoked = await revokeProjectToken({ tokenId, projectId, userId });
  if (!revoked) {
    return c.json(
      errorBody("NOT_FOUND", "Token not found or already revoked", null),
      404,
    );
  }

  return c.json({ revoked: true, id: revoked.id });
});

tokenRoutes.openapi(rotateProjectTokenRoute, async (c) => {
  const { project_id: projectId, token_id: tokenId } = c.req.valid("param");
  const { tenantId, userId, role } = getAuthContext(c);
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenant_id, tenantId)))
    .limit(1);
  if (!project) {
    return c.json(errorBody("NOT_FOUND", "Project not found", projectId), 404);
  }
  const hasAccess = await checkProjectAccess(userId, projectId, tenantId, role);
  if (!hasAccess) {
    return c.json(errorBody("NOT_FOUND", "Project not found", projectId), 404);
  }

  const existing = await loadRotatableProjectToken(tokenId, projectId);
  if (!existing || existing.revoked_at !== null) {
    return c.json(
      errorBody("NOT_FOUND", "Token not found or already revoked", null),
      404,
    );
  }

  if (
    !canManageExistingToken({
      role,
      action: "rotate",
      ownsToken: existing.owner_user_id === userId,
    })
  ) {
    return c.json(
      errorBody("FORBIDDEN", "Access denied to this token", null),
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
});
