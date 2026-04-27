/**
 * RBAC helpers — role-based and project-scoped access checks.
 *
 * Role hierarchy (highest to lowest):
 *   owner  — full tenant control
 *   admin  — same as owner
 *   demo   — broad read access; intentionally non-mutating by default
 *   member — project-scoped; can manage their projects, create projects, invite member/guest
 *   guest  — project-scoped; manage assigned projects only, cannot create or invite
 */

import type { Context } from "hono";
import { db } from "../db/index.js";
import { project_members, projects } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { errorResult, okResult, type HttpResult } from "../http/responses.js";

type RolesWithFlag<
  T extends Record<string, Record<string, boolean>>,
  Flag extends string,
> = {
  [K in keyof T]: Flag extends keyof T[K]
    ? T[K][Flag] extends true
      ? K
      : never
    : never;
}[keyof T];

export const TENANT_ROLE_METADATA = {
  owner: {
    inviteAssignable: false,
    directCreateAssignable: false,
    ownerLevel: true,
    implicitProjectAccess: true,
  },
  admin: {
    inviteAssignable: true,
    directCreateAssignable: true,
    ownerLevel: true,
    implicitProjectAccess: true,
  },
  demo: {
    inviteAssignable: false,
    directCreateAssignable: true,
    ownerLevel: false,
    implicitProjectAccess: true,
  },
  member: {
    inviteAssignable: true,
    directCreateAssignable: true,
    ownerLevel: false,
    implicitProjectAccess: false,
  },
  guest: {
    inviteAssignable: true,
    directCreateAssignable: true,
    ownerLevel: false,
    implicitProjectAccess: false,
  },
} as const;

export type TenantRole = keyof typeof TENANT_ROLE_METADATA;
export type AssignableTenantRole = RolesWithFlag<
  typeof TENANT_ROLE_METADATA,
  "inviteAssignable"
>;
export type DirectCreatableTenantRole = RolesWithFlag<
  typeof TENANT_ROLE_METADATA,
  "directCreateAssignable"
>;
export type ManageableTenantRole = Exclude<TenantRole, "owner">;

export const TENANT_ROLES = Object.keys(TENANT_ROLE_METADATA) as TenantRole[];

export const ASSIGNABLE_TENANT_ROLES = TENANT_ROLES.filter(
  (role): role is AssignableTenantRole =>
    TENANT_ROLE_METADATA[role].inviteAssignable,
);

export const DIRECT_CREATABLE_TENANT_ROLES = TENANT_ROLES.filter(
  (role): role is DirectCreatableTenantRole =>
    TENANT_ROLE_METADATA[role].directCreateAssignable,
);

export const CAPABILITY_KEYS = [
  "overview.read",
  "projects.read",
  "projects.create",
  "projects.delete",
  "events.read_tenant",
  "events.read_project",
  "performance.read",
  "policy.read_tenant",
  "policy.read_project",
  "policy.write_tenant",
  "policy.write_project",
  "rules.read",
  "rules.write",
  "policy_assignments.read",
  "policy_assignments.write",
  "policy_preview.read",
  "connectors.read",
  "connectors.write",
  "security.read_tenant",
  "security.read_project",
  "security.write",
  "packages.read_tenant",
  "packages.read_project",
  "packages.rebuild",
  "tokens.read_all",
  "tokens.read_own",
  "tokens.create",
  "tokens.revoke_any",
  "tokens.revoke_own",
  "tokens.rotate_any",
  "tokens.rotate_own",
  "members.read",
  "members.invite",
  "members.invite_admin",
  "members.invite_unscoped",
  "members.write_roles",
  "members.create_password_user",
  "members.reset_password",
  "settings.read",
  "settings.write",
  "proxies.read",
  "proxies.write",
  "mcp.read",
  "mcp.connect",
  "mcp.use_project",
  "mcp.use_tenant",
  "violations.read_tenant",
  "violations.read_project",
  "violations.write",
] as const;

export type TenantCapability = (typeof CAPABILITY_KEYS)[number];

export type CapabilityContext = {
  hasProjectAccess?: boolean;
  ownsToken?: boolean;
};

const ROLE_CAPABILITIES: Record<TenantRole, ReadonlySet<TenantCapability>> = {
  owner: new Set(CAPABILITY_KEYS),
  admin: new Set(
    CAPABILITY_KEYS.filter(
      (capability) =>
        capability !== "mcp.use_tenant" &&
        capability !== "members.create_password_user",
    ),
  ),
  demo: new Set([
    "overview.read",
    "projects.read",
    "events.read_tenant",
    "events.read_project",
    "performance.read",
    "policy.read_tenant",
    "policy.read_project",
    "rules.read",
    "policy_assignments.read",
    "policy_preview.read",
    "connectors.read",
    "security.read_tenant",
    "security.read_project",
    "packages.read_tenant",
    "packages.read_project",
    "tokens.read_own",
    "tokens.create",
    //"members.read",
    "settings.read",
    "proxies.read",
    "mcp.read",
    "mcp.connect",
    "mcp.use_project",
    "violations.read_tenant",
    "violations.read_project",
  ]),
  member: new Set([
    "overview.read",
    "projects.read",
    "projects.create",
    "events.read_project",
    "policy.read_tenant",
    "policy.read_project",
    "rules.read",
    "policy_assignments.read",
    "policy_preview.read",
    "connectors.read",
    "security.read_project",
    "packages.read_project",
    "tokens.read_own",
    "tokens.create",
    "tokens.revoke_own",
    "tokens.rotate_own",
    "members.invite",
    "members.invite_unscoped",
    "proxies.read",
    "mcp.read",
    "mcp.connect",
    "mcp.use_project",
    "violations.read_project",
  ]),
  guest: new Set([
    "overview.read",
    "projects.read",
    "events.read_project",
    "security.read_project",
    "packages.read_project",
    "violations.read_project",
  ]),
};

export function isTenantRole(role: string): role is TenantRole {
  return TENANT_ROLES.includes(role as TenantRole);
}

export function isAssignableTenantRole(
  role: string,
): role is AssignableTenantRole {
  return isTenantRole(role) && TENANT_ROLE_METADATA[role].inviteAssignable;
}

export function isDirectCreatableTenantRole(
  role: string,
): role is DirectCreatableTenantRole {
  return (
    isTenantRole(role) && TENANT_ROLE_METADATA[role].directCreateAssignable
  );
}

export function isManageableTenantRole(
  role: string,
): role is ManageableTenantRole {
  return isTenantRole(role) && role !== "owner";
}

/** Returns true if the role has owner-level (owner or admin) privileges. */
export function isOwnerOrAdmin(role: string): boolean {
  return isTenantRole(role) && TENANT_ROLE_METADATA[role].ownerLevel;
}

export function hasImplicitProjectAccess(role: string): boolean {
  return isTenantRole(role) && TENANT_ROLE_METADATA[role].implicitProjectAccess;
}

export function isTenantCapability(value: string): value is TenantCapability {
  return CAPABILITY_KEYS.includes(value as TenantCapability);
}

export function canPerform(
  role: TenantRole,
  capability: TenantCapability,
  context: CapabilityContext = {},
): boolean {
  if (!ROLE_CAPABILITIES[role].has(capability)) {
    return false;
  }

  switch (capability) {
    case "security.read_project":
    case "packages.read_project":
    case "violations.read_project":
    case "policy.read_project":
    case "events.read_project":
    case "mcp.use_project":
      return context.hasProjectAccess ?? true;
    case "tokens.revoke_own":
    case "tokens.rotate_own":
      return context.ownsToken ?? false;
    default:
      return true;
  }
}

export function getInvitableTenantRoles(
  role: TenantRole,
): readonly AssignableTenantRole[] {
  return canPerform(role, "members.invite_admin")
    ? ASSIGNABLE_TENANT_ROLES
    : ASSIGNABLE_TENANT_ROLES.filter((candidate) => candidate !== "admin");
}

export function canInviteTenantRole(
  actorRole: TenantRole,
  targetRole: AssignableTenantRole,
): boolean {
  return getInvitableTenantRoles(actorRole).includes(targetRole);
}

export function canInviteWithoutProjectScope(role: TenantRole): boolean {
  return canPerform(role, "members.invite_unscoped");
}

export function getDirectCreatableTenantRoles(
  role: TenantRole,
): readonly DirectCreatableTenantRole[] {
  return canPerform(role, "members.create_password_user")
    ? DIRECT_CREATABLE_TENANT_ROLES
    : [];
}

export function canDirectCreateTenantRole(
  actorRole: TenantRole,
  targetRole: DirectCreatableTenantRole,
): boolean {
  return getDirectCreatableTenantRoles(actorRole).includes(targetRole);
}

export function shouldAutoJoinCreatedProject(role: TenantRole): boolean {
  return role === "member";
}

/**
 * For member/guest: queries project_members to check project access.
 * For owner/admin: always returns true (implicit access to all projects).
 */
export async function checkProjectAccess(
  userId: string,
  projectId: string,
  tenantId: string,
  role: string,
): Promise<boolean> {
  if (hasImplicitProjectAccess(role)) return true;

  const [row] = await db
    .select({ project_id: project_members.project_id })
    .from(project_members)
    .where(
      and(
        eq(project_members.project_id, projectId),
        eq(project_members.tenant_id, tenantId),
        eq(project_members.user_id, userId),
      ),
    )
    .limit(1);

  return !!row;
}

/**
 * Loads a project scoped to the caller's tenant and enforces project access.
 *
 * By default, access denials return 403. Set hideForbiddenAsNotFound=true for
 * routes that intentionally hide project existence from unauthorized callers.
 */
export async function resolveProjectWithAccess(
  c: Context,
  projectId: string,
  tenantId: string,
  userId: string,
  role: string,
  options: { hideForbiddenAsNotFound?: boolean } = {},
): Promise<HttpResult<typeof projects.$inferSelect>> {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenant_id, tenantId)))
    .limit(1);

  if (!project) {
    return errorResult(c, 404, "NOT_FOUND", "Project not found", projectId);
  }

  const hasAccess = await checkProjectAccess(userId, projectId, tenantId, role);
  if (!hasAccess) {
    const status = options.hideForbiddenAsNotFound ? 404 : 403;
    const code = options.hideForbiddenAsNotFound ? "NOT_FOUND" : "FORBIDDEN";
    const message = options.hideForbiddenAsNotFound
      ? "Project not found"
      : "Access denied to this project";

    return errorResult(
      c,
      status,
      code,
      message,
      options.hideForbiddenAsNotFound ? projectId : null,
    );
  }

  return okResult(project);
}
