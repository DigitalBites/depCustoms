import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { CAPABILITY } from "@customs/shared-constants";
import { db } from "../../db/index.js";
import { memberships, project_members } from "../../db/schema.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";
import {
  requireTenantCapability,
  getAuthContext,
  requireResolvedProjectAccess,
  requireTenantParamAccess,
} from "../../http/guards.js";
import {
  AuthAdminServiceError,
  authAdminService,
  type AuthAdminUser,
} from "../../auth/admin-service.js";
import {
  canDirectCreateTenantRole,
  hasImplicitProjectAccess,
  isTenantRole,
} from "../../middleware/rbac.js";
import {
  createMemberSchema,
  patchMemberRoleSchema,
  resetPasswordSchema,
} from "./shared.js";

export const tenantMemberRouter = new Hono();

tenantMemberRouter.get("/v1/tenants/:tenant_id/members", async (c) => {
  const tenantIdResult = requireTenantParamAccess(c);
  if (!tenantIdResult.ok) return tenantIdResult.response;
  const tenantId = tenantIdResult.value;

  const capabilityResult = requireTenantCapability(
    c,
    CAPABILITY.MEMBERS_READ,
    "Access denied",
  );
  if (!capabilityResult.ok) return capabilityResult.response;

  const memberRows = await db
    .select({
      user_id: memberships.user_id,
      role: memberships.role,
      joined_at: memberships.created_at,
    })
    .from(memberships)
    .where(eq(memberships.tenant_id, tenantId));

  const emailMap = new Map<string, string>();
  const providerMap = new Map<string, string>();
  const lastSignInMap = new Map<string, string | null>();
  try {
    const users = await authAdminService.listUsers();
    for (const user of users) {
      if (user.email) emailMap.set(user.id, user.email);
      if (user.app_metadata?.provider) {
        providerMap.set(user.id, user.app_metadata.provider);
      }
      lastSignInMap.set(user.id, user.last_sign_in_at ?? null);
    }
  } catch {
    // Non-fatal: return members without auth enrichment.
  }

  const members = memberRows.map((member) => ({
    user_id: member.user_id,
    email: emailMap.get(member.user_id) ?? null,
    role: member.role,
    joined_at: member.joined_at,
    provider: providerMap.get(member.user_id) ?? null,
    last_sign_in_at: lastSignInMap.get(member.user_id) ?? null,
  }));

  return c.json({ members });
});

tenantMemberRouter.post(
  "/v1/tenants/:tenant_id/members",
  zValidator("json", createMemberSchema),
  async (c) => {
    const tenantIdResult = requireTenantParamAccess(c);
    if (!tenantIdResult.ok) return tenantIdResult.response;
    const tenantId = tenantIdResult.value;
    const { role: authRole } = getAuthContext(c);
    const { email, password, role, project_id } = c.req.valid("json");
    const scopedProjectId = hasImplicitProjectAccess(role)
      ? undefined
      : project_id;

    const capabilityResult = requireTenantCapability(
      c,
      "members.create_password_user",
      "You do not have access to create tenant accounts",
    );
    if (!capabilityResult.ok) {
      return capabilityResult.response;
    }

    if (!isTenantRole(authRole) || !canDirectCreateTenantRole(authRole, role)) {
      return errorJson(
        c,
        403,
        "FORBIDDEN",
        `You do not have access to create users with role "${role}"`,
      );
    }

    if (scopedProjectId) {
      const accessResult = await requireResolvedProjectAccess(c, scopedProjectId);
      if (!accessResult.ok) return accessResult.response;
    }

    let createdUser: AuthAdminUser;
    try {
      createdUser = await authAdminService.createUser(email, password);
    } catch (err) {
      if (
        err instanceof AuthAdminServiceError &&
        err.kind === "misconfigured"
      ) {
        return errorJson(
          c,
          500,
          "SERVER_MISCONFIGURED",
          "Auth service is not configured",
        );
      }

      if (
        err instanceof AuthAdminServiceError &&
        err.kind === "upstream" &&
        (err.status === 400 || err.status === 409 || err.status === 422)
      ) {
        return errorJson(
          c,
          409,
          "USER_EXISTS",
          "A user with that email already exists",
        );
      }

      return errorJson(c, 500, "CREATE_MEMBER_FAILED", "Failed to create user");
    }

    try {
      await db.transaction(async (tx) => {
        await tx.insert(memberships).values({
          user_id: createdUser.id,
          tenant_id: tenantId,
          role,
        });

        if (scopedProjectId) {
          await tx.insert(project_members).values({
            project_id: scopedProjectId,
            tenant_id: tenantId,
            user_id: createdUser.id,
          });
        }
      });
    } catch (_dbErr) {
      await authAdminService.deleteUser(createdUser.id).catch(() => {});
      return errorJson(
        c,
        500,
        "CREATE_MEMBER_FAILED",
        "Failed to record membership for the new user",
      );
    }

    return c.json(
      {
        created: {
          email,
          role,
        },
      },
      201,
    );
  },
);

tenantMemberRouter.patch(
  "/v1/tenants/:tenant_id/members/:user_id",
  zValidator("json", patchMemberRoleSchema),
  async (c) => {
    const tenantIdResult = requireTenantParamAccess(c);
    if (!tenantIdResult.ok) return tenantIdResult.response;
    const tenantId = tenantIdResult.value;
    const targetUserIdResult = validateUuidParam(c, "user_id", "User ID");
    if (!targetUserIdResult.ok) return targetUserIdResult.response;
    const targetUserId = targetUserIdResult.value;
    const { role } = c.req.valid("json");

    const capabilityResult = requireTenantCapability(c, "members.write_roles", "Access denied");
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    const [existing] = await db
      .select({
        user_id: memberships.user_id,
        role: memberships.role,
      })
      .from(memberships)
      .where(
        and(
          eq(memberships.user_id, targetUserId),
          eq(memberships.tenant_id, tenantId),
        ),
      )
      .limit(1);

    if (!existing) {
      return errorJson(c, 404, "NOT_FOUND", "User not found in this tenant");
    }

    if (existing.role === "owner") {
      return errorJson(
        c,
        409,
        "INVALID_STATE",
        "Owner role cannot be changed through member management",
      );
    }

    const [updated] = await db
      .update(memberships)
      .set({ role })
      .where(
        and(
          eq(memberships.user_id, targetUserId),
          eq(memberships.tenant_id, tenantId),
        ),
      )
      .returning({
        user_id: memberships.user_id,
        role: memberships.role,
        joined_at: memberships.created_at,
      });

    return c.json({ member: updated });
  },
);

tenantMemberRouter.post(
  "/v1/tenants/:tenant_id/members/:user_id/reset-password",
  zValidator("json", resetPasswordSchema),
  async (c) => {
    const tenantIdResult = requireTenantParamAccess(c);
    if (!tenantIdResult.ok) return tenantIdResult.response;
    const tenantId = tenantIdResult.value;
    const targetUserIdResult = validateUuidParam(c, "user_id", "User ID");
    if (!targetUserIdResult.ok) return targetUserIdResult.response;
    const targetUserId = targetUserIdResult.value;
    const { password } = c.req.valid("json");

    const capabilityResult = requireTenantCapability(
      c,
      "members.reset_password",
      "Access denied",
    );
    if (!capabilityResult.ok) return capabilityResult.response;

    const [membership] = await db
      .select({ user_id: memberships.user_id })
      .from(memberships)
      .where(
        and(
          eq(memberships.user_id, targetUserId),
          eq(memberships.tenant_id, tenantId),
        ),
      )
      .limit(1);

    if (!membership) {
      return errorJson(c, 404, "NOT_FOUND", "User not found in this tenant");
    }

    let gotrueUser: AuthAdminUser | null;
    try {
      gotrueUser = await authAdminService.getUser(targetUserId);
    } catch (err) {
      if (
        err instanceof AuthAdminServiceError &&
        err.kind === "misconfigured"
      ) {
        return errorJson(
          c,
          500,
          "SERVER_MISCONFIGURED",
          "Auth service is not configured",
        );
      }
      return errorJson(c, 500, "RESET_FAILED", "Failed to reset password");
    }

    if (!gotrueUser) {
      return errorJson(
        c,
        404,
        "USER_NOT_FOUND",
        "User not found in auth system",
      );
    }

    if (gotrueUser.app_metadata?.provider !== "email") {
      return errorJson(
        c,
        400,
        "SSO_ACCOUNT",
        "Cannot reset password for SSO-managed accounts",
      );
    }

    try {
      await authAdminService.updateUser(targetUserId, { password });
    } catch (err) {
      if (
        err instanceof AuthAdminServiceError &&
        err.kind === "misconfigured"
      ) {
        return errorJson(
          c,
          500,
          "SERVER_MISCONFIGURED",
          "Auth service is not configured",
        );
      }
      return errorJson(c, 500, "RESET_FAILED", "Failed to reset password");
    }

    return c.json({ ok: true });
  },
);
