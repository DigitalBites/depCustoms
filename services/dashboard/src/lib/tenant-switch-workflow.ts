import { getSafeRedirectPath } from "@/lib/redirect";

export type TenantSwitchSession = {
  access_token: string;
  refresh_token: string;
};

export type TenantSwitchDependencies = {
  persistPreferredTenant: (tenantId: string) => Promise<void>;
  clearCache: () => void;
  refreshSession: () => Promise<{
    data: { session: TenantSwitchSession | null };
    error: unknown;
  }>;
  syncSession: (session: TenantSwitchSession | null) => Promise<void>;
  redirect: (path: string) => void;
};

export async function switchTenantWithDependencies(
  tenantId: string,
  redirectTo: string,
  dependencies: TenantSwitchDependencies,
): Promise<void> {
  await dependencies.persistPreferredTenant(tenantId);
  dependencies.clearCache();

  const { data, error } = await dependencies.refreshSession();
  if (error) {
    throw error instanceof Error ? error : new Error("Session refresh failed");
  }

  await dependencies.syncSession(data.session);
  dependencies.clearCache();
  dependencies.redirect(getSafeRedirectPath(redirectTo));
}
