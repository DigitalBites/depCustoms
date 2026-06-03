import { apiFetch, clearApiFetchCache } from "@/lib/api";
import { syncServerSession } from "@/lib/session-sync";
import { createBrowserClient } from "@/lib/supabase-browser";
import { switchTenantWithDependencies } from "@/lib/tenant-switch-workflow";

export async function switchTenant(
  tenantId: string,
  redirectTo = "/setup",
): Promise<void> {
  const supabase = createBrowserClient();
  await switchTenantWithDependencies(tenantId, redirectTo, {
    persistPreferredTenant: async (nextTenantId) => {
      await apiFetch("/v1/auth/preferred-tenant", {
        method: "POST",
        body: JSON.stringify({ tenant_id: nextTenantId }),
      });
    },
    clearCache: clearApiFetchCache,
    refreshSession: () => supabase.auth.refreshSession(),
    syncSession: syncServerSession,
    redirect: (path) => window.location.assign(path),
  });
}
