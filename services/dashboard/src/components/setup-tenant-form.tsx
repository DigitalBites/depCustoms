"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { syncServerSession } from "@/lib/session-sync";
import { createBrowserClient } from "@/lib/supabase-browser";

export function SetupTenantForm({
  tenantId,
  initialName,
}: {
  tenantId: string;
  initialName: string;
}) {
  const [name, setName] = useState(initialName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await apiFetch(`/v1/tenants/${tenantId}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      const supabase = createBrowserClient();
      const {
        data: { session },
        error: refreshError,
      } = await supabase.auth.refreshSession();
      if (refreshError) {
        throw refreshError;
      }
      await syncServerSession(session);
      window.location.assign("/dashboard");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update tenant name",
      );
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3">
      <label className="block">
        <span className="text-sm font-medium text-foreground">Tenant name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your organisation"
          required
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>

      {error ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {loading ? "Saving…" : "Rename tenant and continue"}
      </button>
    </form>
  );
}
