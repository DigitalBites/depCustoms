import { useCallback } from "react";
import {
  createTenantMember,
  fetchTenantMembers,
  resetTenantMemberPassword,
  sendTenantInvite,
  updateTenantMemberRole,
} from "@/features/users/api";
import type {
  CreateTenantMemberRequest,
  MutationResult,
  TenantInviteRequest,
  TenantAccessGrantResponse,
  TenantMember,
} from "@/features/users/types";
import {
  getDashboardRoleSortOrder,
  type DashboardRole,
} from "@/lib/dashboard-roles";
import { useMutation } from "@/hooks/useMutation";
import { useResource } from "@/hooks/useResource";

export function useTenantMembers(tenantId: string) {
  const loadMembers = useCallback(async () => {
    const members = await fetchTenantMembers(tenantId);
    members.sort((a, b) => {
      const ra = getDashboardRoleSortOrder(a.role);
      const rb = getDashboardRoleSortOrder(b.role);
      if (ra !== rb) {
        return ra - rb;
      }
      return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
    });
    return members;
  }, [tenantId]);
  const { data: members, loading, error, reload } = useResource<TenantMember[]>(
    loadMembers,
    {
      initialData: [],
      errorPrefix: "Failed to load members",
    },
  );

  return {
    members,
    loading,
    error,
    reload,
  };
}

export function useResetMemberPassword(tenantId: string) {
  const { pending: saving, run } = useMutation(
    (userId: string, password: string) =>
      resetTenantMemberPassword(tenantId, userId, password),
    "Failed to reset password",
  );

  async function resetPassword(
    userId: string,
    password: string,
  ): Promise<MutationResult> {
    const result = await run(userId, password);
    if (!result.ok) {
      return result;
    }
    return { ok: true as const };
  }

  return {
    saving,
    resetPassword,
  };
}

export function useSendInvite(tenantId: string) {
  const { pending: sending, run } = useMutation(
    (body: TenantInviteRequest) => sendTenantInvite(tenantId, body),
    "Failed to send invite",
  );

  async function sendInvite(
    body: TenantInviteRequest,
  ): Promise<
    MutationResult & {
      outcome?: TenantAccessGrantResponse["access"]["outcome"];
    }
  > {
    const result = await run(body);
    if (!result.ok) {
      return result;
    }
    return {
      ok: true as const,
      outcome: result.data.access.outcome,
    };
  }

  return {
    sending,
    sendInvite,
  };
}

export function useUpdateMemberRole(tenantId: string) {
  const { pending: saving, run } = useMutation(
    (userId: string, role: DashboardRole) =>
      updateTenantMemberRole(tenantId, userId, role),
    "Failed to update role",
  );

  async function updateRole(
    userId: string,
    role: DashboardRole,
  ): Promise<MutationResult> {
    const result = await run(userId, role);
    if (!result.ok) {
      return result;
    }
    return { ok: true as const };
  }

  return {
    saving,
    updateRole,
  };
}

export function useCreateTenantMember(tenantId: string) {
  const { pending: saving, run } = useMutation(
    (body: CreateTenantMemberRequest) => createTenantMember(tenantId, body),
    "Failed to create member",
  );

  async function createMember(
    body: CreateTenantMemberRequest,
  ): Promise<MutationResult> {
    const result = await run(body);
    if (!result.ok) {
      return result;
    }
    return { ok: true as const };
  }

  return {
    saving,
    createMember,
  };
}
