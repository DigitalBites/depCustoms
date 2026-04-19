import { apiFetch } from "@/lib/api";
import { getSafeRedirectPath } from "@/lib/redirect";
import { createBrowserClient } from "@/lib/supabase-browser";

export async function switchTenant(
  tenantId: string,
  redirectTo = "/setup",
): Promise<void> {
  await apiFetch("/v1/auth/preferred-tenant", {
    method: "POST",
    body: JSON.stringify({ tenant_id: tenantId }),
  });

  const supabase = createBrowserClient();
  const { error } = await supabase.auth.refreshSession();
  if (error) {
    throw error;
  }

  window.location.assign(getSafeRedirectPath(redirectTo));
}
