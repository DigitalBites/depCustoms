import { useCallback, useEffect, useState } from "react";
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
import { getUserErrorMessage } from "@/lib/api-error";
import {
  getDashboardRoleSortOrder,
  type DashboardRole,
} from "@/lib/dashboard-roles";

export function useTenantMembers(tenantId: string) {
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const members = await fetchTenantMembers(tenantId);
      members.sort((a, b) => {
        const ra = getDashboardRoleSortOrder(a.role);
        const rb = getDashboardRoleSortOrder(b.role);
        if (ra !== rb) {
          return ra - rb;
        }
        return (
          new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
        );
      });
      setMembers(members);
    } catch (err) {
      setMembers([]);
      setError(getUserErrorMessage(err, "Failed to load members"));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    members,
    loading,
    error,
    reload,
  };
}

export function useResetMemberPassword(tenantId: string) {
  const [saving, setSaving] = useState(false);

  async function resetPassword(
    userId: string,
    password: string,
  ): Promise<MutationResult> {
    setSaving(true);
    try {
      await resetTenantMemberPassword(tenantId, userId, password);
      return { ok: true as const };
    } catch (err) {
      return {
        ok: false as const,
        error: getUserErrorMessage(err, "Failed to reset password"),
      };
    } finally {
      setSaving(false);
    }
  }

  return {
    saving,
    resetPassword,
  };
}

export function useSendInvite(tenantId: string) {
  const [sending, setSending] = useState(false);

  async function sendInvite(
    body: TenantInviteRequest,
  ): Promise<
    MutationResult & {
      outcome?: TenantAccessGrantResponse["access"]["outcome"];
    }
  > {
    setSending(true);
    try {
      const result = await sendTenantInvite(tenantId, body);
      return {
        ok: true as const,
        outcome: result.access.outcome,
      };
    } catch (err) {
      return {
        ok: false as const,
        error: getUserErrorMessage(err, "Failed to send invite"),
      };
    } finally {
      setSending(false);
    }
  }

  return {
    sending,
    sendInvite,
  };
}

export function useUpdateMemberRole(tenantId: string) {
  const [saving, setSaving] = useState(false);

  async function updateRole(
    userId: string,
    role: DashboardRole,
  ): Promise<MutationResult> {
    setSaving(true);
    try {
      await updateTenantMemberRole(tenantId, userId, role);
      return { ok: true as const };
    } catch (err) {
      return {
        ok: false as const,
        error: getUserErrorMessage(err, "Failed to update role"),
      };
    } finally {
      setSaving(false);
    }
  }

  return {
    saving,
    updateRole,
  };
}

export function useCreateTenantMember(tenantId: string) {
  const [saving, setSaving] = useState(false);

  async function createMember(
    body: CreateTenantMemberRequest,
  ): Promise<MutationResult> {
    setSaving(true);
    try {
      await createTenantMember(tenantId, body);
      return { ok: true as const };
    } catch (err) {
      return {
        ok: false as const,
        error: getUserErrorMessage(err, "Failed to create member"),
      };
    } finally {
      setSaving(false);
    }
  }

  return {
    saving,
    createMember,
  };
}
