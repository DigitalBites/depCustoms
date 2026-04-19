import type {
  AssignableDashboardRole,
  DashboardRole,
  DirectCreatableDashboardRole,
} from "@/lib/dashboard-roles";
import {
  ASSIGNABLE_DASHBOARD_ROLES,
  DASHBOARD_ROLE_METADATA,
  DIRECT_CREATABLE_DASHBOARD_ROLES,
} from "@/lib/dashboard-roles";

export const DASHBOARD_CAPABILITY_KEYS = [
  "overview.read",
  "projects.read",
  "projects.read_all",
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

export type DashboardCapability = (typeof DASHBOARD_CAPABILITY_KEYS)[number];

export type DashboardCapabilityContext = {
  hasProjectAccess?: boolean;
  ownsToken?: boolean;
};

const ROLE_CAPABILITIES: Record<
  DashboardRole,
  ReadonlySet<DashboardCapability>
> = {
  owner: new Set(DASHBOARD_CAPABILITY_KEYS),
  admin: new Set(
    DASHBOARD_CAPABILITY_KEYS.filter(
      (capability) =>
        capability !== "mcp.use_tenant" &&
        capability !== "members.create_password_user",
    ),
  ),
  demo: new Set([
    "overview.read",
    "projects.read",
    "projects.read_all",
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

export function isDashboardCapability(
  value: string,
): value is DashboardCapability {
  return DASHBOARD_CAPABILITY_KEYS.includes(value as DashboardCapability);
}

export function canPerform(
  role: DashboardRole,
  capability: DashboardCapability,
  context: DashboardCapabilityContext = {},
): boolean {
  if (!ROLE_CAPABILITIES[role].has(capability)) {
    return false;
  }

  switch (capability) {
    case "projects.read":
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

export const ASSIGNABLE_NON_ADMIN_DASHBOARD_ROLES =
  ASSIGNABLE_DASHBOARD_ROLES.filter(
    (role) =>
      role !== "admin" && DASHBOARD_ROLE_METADATA[role].inviteAssignable,
  );

export function getInvitableDashboardRoles(
  role: DashboardRole,
): readonly AssignableDashboardRole[] {
  return canPerform(role, "members.invite_admin")
    ? ASSIGNABLE_DASHBOARD_ROLES
    : ASSIGNABLE_NON_ADMIN_DASHBOARD_ROLES;
}

export function getDirectCreatableDashboardRoles(
  role: DashboardRole,
): readonly DirectCreatableDashboardRole[] {
  return canPerform(role, "members.create_password_user")
    ? DIRECT_CREATABLE_DASHBOARD_ROLES
    : [];
}
