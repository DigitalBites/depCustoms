type RolesWithFlag<
  T extends Record<string, Record<string, boolean | number | string>>,
  Flag extends string,
> = {
  [K in keyof T]: Flag extends keyof T[K]
    ? T[K][Flag] extends true
      ? K
      : never
    : never;
}[keyof T];

export const DASHBOARD_ROLE_METADATA = {
  owner: {
    inviteAssignable: false,
    directCreateAssignable: false,
    sortOrder: 0,
    badgeClassName:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  },
  admin: {
    inviteAssignable: true,
    directCreateAssignable: true,
    sortOrder: 1,
    managementDescription:
      "Full access. Can manage all projects, users, and settings.",
    badgeClassName:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  demo: {
    inviteAssignable: false,
    directCreateAssignable: true,
    sortOrder: 2,
    managementDescription:
      "Broad read access. Can review tenant and project surfaces without making changes.",
    badgeClassName:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  },
  member: {
    inviteAssignable: true,
    directCreateAssignable: true,
    sortOrder: 3,
    managementDescription:
      "Project-scoped access. Can manage assigned projects and invite guests.",
    badgeClassName: "bg-muted text-foreground",
  },
  guest: {
    inviteAssignable: true,
    directCreateAssignable: true,
    sortOrder: 4,
    managementDescription: "Read-only access to assigned projects.",
    badgeClassName: "bg-muted text-muted-foreground",
  },
} as const;

export type DashboardRole = keyof typeof DASHBOARD_ROLE_METADATA;
export type AssignableDashboardRole = RolesWithFlag<
  typeof DASHBOARD_ROLE_METADATA,
  "inviteAssignable"
>;
export type DirectCreatableDashboardRole = RolesWithFlag<
  typeof DASHBOARD_ROLE_METADATA,
  "directCreateAssignable"
>;

export const DASHBOARD_ROLES = Object.keys(
  DASHBOARD_ROLE_METADATA,
) as DashboardRole[];
export const ASSIGNABLE_DASHBOARD_ROLES = DASHBOARD_ROLES.filter(
  (role): role is AssignableDashboardRole =>
    DASHBOARD_ROLE_METADATA[role].inviteAssignable,
);
export const DIRECT_CREATABLE_DASHBOARD_ROLES = DASHBOARD_ROLES.filter(
  (role): role is DirectCreatableDashboardRole =>
    DASHBOARD_ROLE_METADATA[role].directCreateAssignable,
);

export function isDashboardRole(value: string): value is DashboardRole {
  return DASHBOARD_ROLES.includes(value as DashboardRole);
}

export function isAssignableDashboardRole(
  value: string,
): value is AssignableDashboardRole {
  return (
    isDashboardRole(value) && DASHBOARD_ROLE_METADATA[value].inviteAssignable
  );
}

export function isDirectCreatableDashboardRole(
  value: string,
): value is DirectCreatableDashboardRole {
  return (
    isDashboardRole(value) &&
    DASHBOARD_ROLE_METADATA[value].directCreateAssignable
  );
}

export function normalizeDashboardRole(
  value: string | null | undefined,
): DashboardRole | undefined {
  if (!value || !isDashboardRole(value)) {
    return undefined;
  }

  return value;
}

export function getAssignableDashboardRoleDescription(
  role: AssignableDashboardRole,
): string {
  return DASHBOARD_ROLE_METADATA[role].managementDescription;
}

export function getDirectCreatableDashboardRoleDescription(
  role: DirectCreatableDashboardRole,
): string {
  return DASHBOARD_ROLE_METADATA[role].managementDescription;
}

export function getDashboardRoleDescription(
  role: DashboardRole,
): string | undefined {
  const metadata = DASHBOARD_ROLE_METADATA[role];
  return "managementDescription" in metadata
    ? metadata.managementDescription
    : undefined;
}

export function getDashboardRoleSortOrder(role: string): number {
  if (!isDashboardRole(role)) {
    return DASHBOARD_ROLES.length;
  }

  return DASHBOARD_ROLE_METADATA[role].sortOrder;
}

export function getDashboardRoleBadgeClassName(role: string): string {
  if (!isDashboardRole(role)) {
    return DASHBOARD_ROLE_METADATA.member.badgeClassName;
  }

  return DASHBOARD_ROLE_METADATA[role].badgeClassName;
}

export function canEditDashboardRole(role: string): boolean {
  return isDashboardRole(role) && role !== "owner";
}

export function getEditableDashboardRoles(): readonly Exclude<
  DashboardRole,
  "owner"
>[] {
  return DASHBOARD_ROLES.filter(
    (role): role is Exclude<DashboardRole, "owner"> =>
      canEditDashboardRole(role),
  );
}
