import { apiFetch } from "@/lib/api";
import type { DashboardRole } from "@/lib/dashboard-roles";
import type {
  CreateTenantMemberRequest,
  ResetTenantMemberPasswordRequest,
  TenantInviteRequest,
  TenantAccessGrantResponse,
  TenantMember,
  TenantMembersResponse,
  UpdateTenantMemberRoleRequest,
} from "@/features/users/types";

export async function fetchTenantMembers(
  tenantId: string,
): Promise<TenantMember[]> {
  const data = (await apiFetch(
    `/v1/tenants/${tenantId}/members`,
  )) as TenantMembersResponse;
  return data.members;
}

export async function resetTenantMemberPassword(
  tenantId: string,
  userId: string,
  password: string,
): Promise<void> {
  const body: ResetTenantMemberPasswordRequest = { password };
  await apiFetch(`/v1/tenants/${tenantId}/members/${userId}/reset-password`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function sendTenantInvite(
  tenantId: string,
  body: TenantInviteRequest,
): Promise<TenantAccessGrantResponse> {
  return (await apiFetch(`/v1/tenants/${tenantId}/access-grants`, {
    method: "POST",
    body: JSON.stringify(body),
  })) as TenantAccessGrantResponse;
}

export async function createTenantMember(
  tenantId: string,
  body: CreateTenantMemberRequest,
): Promise<void> {
  await apiFetch(`/v1/tenants/${tenantId}/members`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateTenantMemberRole(
  tenantId: string,
  userId: string,
  role: DashboardRole,
): Promise<void> {
  const body: UpdateTenantMemberRoleRequest = { role };
  await apiFetch(`/v1/tenants/${tenantId}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
