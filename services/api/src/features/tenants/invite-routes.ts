import type { Context } from "hono";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { memberships, project_members } from "../../db/schema.js";
import { errorJson, logInternalFailure } from "../../http/responses.js";
import {
  requireTenantCapability,
  getAuthContext,
  requireResolvedProjectAccess,
  requireTenantParamAccess,
} from "../../http/guards.js";
import {
  canInviteTenantRole,
  canInviteWithoutProjectScope,
  hasImplicitProjectAccess,
  isTenantRole,
  type AssignableTenantRole,
} from "../../middleware/rbac.js";
import {
  AuthAdminServiceError,
  authAdminService,
  type AuthAdminUser,
} from "../../auth/admin-service.js";
import { inviteMemberSchema } from "./shared.js";

export const tenantInviteRouter = new Hono();

async function grantTenantAccess(c: Context) {
  const tenantIdResult = requireTenantParamAccess(c);
  if (!tenantIdResult.ok) return tenantIdResult.response;
  const tenantId = tenantIdResult.value;
  const { role: authRole } = getAuthContext(c);
  const { email, role, project_id } = (
    c.req as {
      valid: (target: "json") => {
        email: string;
        role: AssignableTenantRole;
        project_id?: string;
      };
    }
  ).valid("json");
  const scopedProjectId = hasImplicitProjectAccess(role)
    ? undefined
    : project_id;

  const capabilityResult = requireTenantCapability(
      c,
      "members.invite",
      "You do not have access to manage tenant access",
    );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

  if (!isTenantRole(authRole) || !canInviteTenantRole(authRole, role)) {
    return errorJson(
      c,
      403,
      "FORBIDDEN",
      `You do not have access to grant users the role "${role}"`,
    );
  }
  if (
    isTenantRole(authRole) &&
    !canInviteWithoutProjectScope(authRole) &&
    !scopedProjectId
  ) {
    return errorJson(
      c,
      400,
      "BAD_REQUEST",
      "You must specify a project_id for your current access level",
    );
  }

  if (scopedProjectId) {
    const accessResult = await requireResolvedProjectAccess(c, scopedProjectId);
    if (!accessResult.ok) return accessResult.response;
  }

  let resolvedUser: AuthAdminUser | null;
  try {
    resolvedUser = await authAdminService.findUserByEmail(email);
  } catch (err) {
    if (err instanceof AuthAdminServiceError && err.kind === "misconfigured") {
      return errorJson(
        c,
        500,
        "SERVER_MISCONFIGURED",
        "Auth service is not configured",
      );
    }
    return errorJson(
      c,
      500,
      "LOOKUP_FAILED",
      "Failed to resolve user by email",
    );
  }

  if (resolvedUser) {
    const [existingMembership] = await db
      .select({
        user_id: memberships.user_id,
        role: memberships.role,
      })
      .from(memberships)
      .where(
        and(
          eq(memberships.user_id, resolvedUser.id),
          eq(memberships.tenant_id, tenantId),
        ),
      )
      .limit(1);

    if (existingMembership) {
      let projectAdded = false;
      if (scopedProjectId) {
        const inserted = await db
          .insert(project_members)
          .values({
            project_id: scopedProjectId,
            tenant_id: tenantId,
            user_id: resolvedUser.id,
          })
          .onConflictDoNothing()
          .returning({ id: project_members.id });
        projectAdded = inserted.length > 0;
      }

      return c.json(
        {
          access: {
            outcome: project_id
              ? projectAdded
                ? "project_access_added"
                : "already_had_project_access"
              : "already_in_tenant",
            email,
            role: existingMembership.role,
            role_changed: false,
          },
        },
        200,
      );
    }

    await db.transaction(async (tx) => {
      await tx.insert(memberships).values({
        user_id: resolvedUser.id,
        tenant_id: tenantId,
        role,
      });

      if (scopedProjectId) {
        await tx.insert(project_members).values({
          project_id: scopedProjectId,
          tenant_id: tenantId,
          user_id: resolvedUser.id,
        });
      }
    });

    return c.json(
      {
        access: {
          outcome: scopedProjectId
            ? "tenant_and_project_access_added"
            : "tenant_access_added",
          email,
          role,
          role_changed: false,
        },
      },
      201,
    );
  }

  let invitedUser: AuthAdminUser;
  try {
    invitedUser = await authAdminService.inviteUser(email);
  } catch (err) {
    if (err instanceof AuthAdminServiceError && err.kind === "misconfigured") {
      return errorJson(
        c,
        500,
        "SERVER_MISCONFIGURED",
        "Invite service is not configured",
      );
    }
    return errorJson(c, 500, "INVITE_FAILED", "Failed to send invite email");
  }

  const userPreExisted = !!invitedUser.email_confirmed_at;

  try {
    await db.transaction(async (tx) => {
      await tx.insert(memberships).values({
        user_id: invitedUser.id,
        tenant_id: tenantId,
        role,
      });

      if (scopedProjectId) {
        await tx.insert(project_members).values({
          project_id: scopedProjectId,
          tenant_id: tenantId,
          user_id: invitedUser.id,
        });
      }
    });
  } catch (dbErr) {
    if (!userPreExisted) {
      await authAdminService.deleteUser(invitedUser.id).catch(() => {});
    }
    logInternalFailure("record_invited_membership", dbErr);
    return errorJson(
      c,
      500,
      "INVITE_FAILED",
      "Failed to record membership for invited user",
    );
  }

  return c.json(
    {
      access: {
        outcome: "invite_sent",
        email,
        role,
        role_changed: false,
      },
    },
    201,
  );
}

tenantInviteRouter.post(
  "/v1/tenants/:tenant_id/access-grants",
  zValidator("json", inviteMemberSchema),
  async (c) => grantTenantAccess(c),
);
