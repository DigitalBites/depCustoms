"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { CAPABILITY, type TenantKind } from "@customs/shared-constants";
import { apiFetch, clearApiFetchCache } from "@/lib/api";
import { getUserErrorMessage } from "@/lib/api-error";
import { canPerform } from "@/lib/dashboard-capabilities";
import type { DashboardRole } from "@/lib/dashboard-roles";
import { createBrowserClient } from "@/lib/supabase-browser";
import { syncServerSession } from "@/lib/session-sync";

type EditableTenantNameProps = {
  tenantId: string;
  tenantName: string;
  role: DashboardRole;
  tenantKind: TenantKind;
};

export function EditableTenantName({
  tenantId,
  tenantName,
  role,
  tenantKind,
}: EditableTenantNameProps) {
  const canRename = canPerform(role, CAPABILITY.TENANT_NAME_WRITE, {
    tenantKind,
  });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tenantName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setName(tenantName);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setName(tenantName);
    setError(null);
    setEditing(false);
  }

  async function saveName() {
    const nextName = name.trim();
    if (!nextName) {
      setError("Tenant name is required.");
      return;
    }
    if (nextName === tenantName) {
      setEditing(false);
      setError(null);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/v1/tenants/${tenantId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: nextName }),
      });

      clearApiFetchCache();
      const supabase = createBrowserClient();
      const {
        data: { session },
        error: refreshError,
      } = await supabase.auth.refreshSession();
      if (refreshError) {
        throw refreshError;
      }
      await syncServerSession(session);
      clearApiFetchCache();
      window.location.reload();
    } catch (err) {
      setError(getUserErrorMessage(err, "Failed to update tenant name."));
      setSaving(false);
    }
  }

  if (!canRename || !editing) {
    return (
      <div className="group flex min-w-0 items-center gap-1">
        <span
          className="block min-w-0 truncate text-[11px] font-medium text-muted-foreground"
          title={tenantName}
        >
          {tenantName}
        </span>
        {canRename ? (
          <button
            type="button"
            onClick={startEdit}
            className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground group-hover:flex focus:flex"
            title="Rename tenant"
            aria-label="Rename tenant"
          >
            <Pencil className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <form
        className="flex min-w-0 items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          void saveName();
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancelEdit();
            }
          }}
          maxLength={100}
          disabled={saving}
          autoFocus
          className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-[11px] font-medium text-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          aria-label="Tenant name"
        />
        <button
          type="submit"
          disabled={saving}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          title="Save tenant name"
          aria-label="Save tenant name"
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
        </button>
        <button
          type="button"
          onClick={cancelEdit}
          disabled={saving}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          title="Cancel"
          aria-label="Cancel tenant rename"
        >
          <X className="h-3 w-3" />
        </button>
      </form>
      {error ? (
        <p className="mt-1 truncate text-[10px] text-destructive" title={error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

