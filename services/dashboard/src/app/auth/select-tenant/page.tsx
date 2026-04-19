"use client";

/**
 * Tenant selector — shown after login when a user belongs to multiple tenants.
 *
 * Reads the tenants array from the current JWT (embedded by the token hook),
 * lets the user pick one, then:
 *   1. Persists the preferred tenant in the API.
 *   2. Refreshes the session so the token hook re-issues the JWT with the
 *      correct tenant_id and role stamped in.
 *   3. Redirects to /setup.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase-browser";
import { getUserErrorMessage } from "@/lib/api-error";
import {
  parseAccessTokenMetadata,
  type TokenTenantInfo,
} from "@/lib/jwt-metadata";
import { switchTenant } from "@/lib/tenant-switch";

export default function SelectTenantPage() {
  const [tenants, setTenants] = useState<TokenTenantInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    async function loadTenants() {
      const supabase = createBrowserClient();
      const { data } = await supabase.auth.getSession();

      if (!data.session) {
        router.replace("/login");
        return;
      }

      try {
        const metadata = parseAccessTokenMetadata(data.session.access_token);
        const list = metadata?.tenants ?? [];

        if (list.length === 0) {
          router.replace("/login");
          return;
        }
        if (list.length === 1) {
          // Single-tenant user shouldn't be here — go straight to dashboard
          router.replace("/setup");
          return;
        }

        setTenants(list);
      } catch {
        router.replace("/login?error=auth_failed");
      } finally {
        setLoading(false);
      }
    }

    void loadTenants();
  }, [router]);

  async function handleSelect(tenantId: string) {
    setSelecting(tenantId);
    setError(null);
    try {
      await switchTenant(tenantId);
    } catch (err) {
      setError(getUserErrorMessage(err, "Failed to switch tenant"));
      setSelecting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            Choose a workspace
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You belong to multiple tenants. Select one to continue.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {tenants.map((t) => (
            <button
              type="button"
              key={t.tenant_id}
              onClick={() => handleSelect(t.tenant_id)}
              disabled={!!selecting}
              className="w-full rounded-lg border border-border bg-card px-5 py-4 text-left transition-colors hover:bg-accent hover:border-ring disabled:opacity-50"
            >
              <p className="font-medium text-foreground">{t.tenant_name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground capitalize">
                {selecting === t.tenant_id ? "Switching…" : t.role}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
