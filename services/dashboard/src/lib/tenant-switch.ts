import { apiFetch, clearApiFetchCache } from "@/lib/api";
import { getSafeRedirectPath } from "@/lib/redirect";
import { syncServerSession } from "@/lib/session-sync";
import { createBrowserClient } from "@/lib/supabase-browser";

export async function switchTenant(
  tenantId: string,
  redirectTo = "/setup",
): Promise<void> {
  await apiFetch("/v1/auth/preferred-tenant", {
    method: "POST",
    body: JSON.stringify({ tenant_id: tenantId }),
  });

  clearApiFetchCache();
  const supabase = createBrowserClient();
  const { data, error } = await supabase.auth.refreshSession();
  if (error) {
    throw error;
  }
  await syncServerSession(data.session);
  clearApiFetchCache();

  window.location.assign(getSafeRedirectPath(redirectTo));
}
