import type {
  AssignableDashboardRole,
  DashboardRole,
  DirectCreatableDashboardRole,
} from "@/lib/dashboard-roles";

export interface TenantMember {
  user_id: string;
  email: string | null;
  role: DashboardRole;
  joined_at: string;
  provider: string | null;
  last_sign_in_at?: string | null;
}

export type InviteRole = AssignableDashboardRole;
export type DirectCreateRole = DirectCreatableDashboardRole;

export interface TenantMembersResponse {
  members: TenantMember[];
}

export interface ResetTenantMemberPasswordRequest {
  password: string;
}

export interface TenantInviteRequest {
  email: string;
  role: InviteRole;
  project_id?: string;
}

export interface TenantAccessGrantResponse {
  access: {
    outcome:
      | "project_access_added"
      | "already_had_project_access"
      | "already_in_tenant"
      | "tenant_and_project_access_added"
      | "tenant_access_added"
      | "invite_sent";
    email: string;
    role: DashboardRole;
    role_changed: boolean;
  };
}

export interface CreateTenantMemberRequest {
  email: string;
  password: string;
  role: DirectCreateRole;
  project_id?: string;
}

export interface UpdateTenantMemberRoleRequest {
  role: DashboardRole;
}

export type MutationResult = { ok: true } | { ok: false; error: string };

export interface ResetPasswordTarget {
  userId: string;
  email: string | null;
}
