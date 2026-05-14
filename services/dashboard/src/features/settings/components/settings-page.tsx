"use client";

import type { FormEvent } from "react";
import { useDashboard } from "@/components/dashboard-provider";
import { InlineError } from "@/components/feedback/inline-error";
import { PageLoading } from "@/components/feedback/page-loading";
import { PageHeader } from "@/components/layout/page-header";
import { useTenantEntitlements } from "@/features/settings/hooks";
import { canPerform } from "@/lib/dashboard-capabilities";
import { SUPPORTED_ECOSYSTEMS } from "@/lib/ecosystems";
import { SERVE_MODE } from "@customs/shared-constants";
import type { ServeMode } from "@customs/shared-constants";

export function SettingsPage() {
  const { tenantId, role } = useDashboard();
  const canReadSettings = canPerform(role, "settings.read");
  const canWriteSettings = canPerform(role, "settings.write");
  const {
    loading,
    saving,
    error,
    errorStatus,
    success,
    allowedEcosystems,
    serveMode,
    cacheTtl,
    mcpEnabled,
    setServeMode,
    setCacheTtl,
    setMcpEnabled,
    toggleEcosystem,
    save,
  } = useTenantEntitlements(tenantId);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    await save();
  }

  if (loading) return <PageLoading />;

  if (!canReadSettings || errorStatus === 403) {
    return (
      <div className="max-w-2xl space-y-6">
        <PageHeader
          title="Settings"
          description="Tenant-level proxy and ecosystem configuration."
          className="mb-0"
        />
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">
            Access denied
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            You do not have access to view or manage tenant entitlements.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      <PageHeader
        title="Settings"
        description="Tenant-level proxy and ecosystem configuration."
        className="mb-0"
      />
      <InlineError message={error} />
      <form onSubmit={handleSave} className="space-y-8">
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Proxy Configuration
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              How proxies under this tenant serve and cache package requests.
            </p>
          </div>
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Serve mode
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Redirect issues a 302; Pull streams the artifact through the
                  proxy.
                </p>
              </div>
              {canWriteSettings ? (
                <div className="relative">
                  <select
                    value={serveMode}
                    onChange={(e) => setServeMode(e.target.value as ServeMode)}
                    className="appearance-none rounded-md border border-border bg-background px-3 py-1.5 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value={SERVE_MODE.REDIRECT}>Redirect</option>
                    <option value={SERVE_MODE.PULL}>Pull</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                </div>
              ) : (
                <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-mono text-foreground">
                  {serveMode}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Cache TTL</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  How long the proxy caches policy decisions before re-checking
                  (seconds).
                </p>
              </div>
              {canWriteSettings ? (
                <input
                  type="number"
                  value={cacheTtl}
                  onChange={(e) =>
                    setCacheTtl(
                      Math.max(30, parseInt(e.target.value, 10) || 300),
                    )
                  }
                  min={30}
                  max={86400}
                  className="w-24 rounded-md border border-border bg-background px-3 py-1.5 text-right text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              ) : (
                <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-mono text-foreground">
                  {cacheTtl}s
                </span>
              )}
            </div>
          </div>
        </section>
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Developer Integrations
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Control whether tenant members can connect external MCP-compatible
              developer tools.
            </p>
          </div>
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  MCP access
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Enables user-bound MCP connections for Codex, Claude Code, and
                  other supported clients.
                </p>
              </div>
              {canWriteSettings ? (
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={mcpEnabled}
                    onChange={(e) => setMcpEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                  {mcpEnabled ? "Enabled" : "Disabled"}
                </label>
              ) : (
                <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-mono text-foreground">
                  {mcpEnabled ? "enabled" : "disabled"}
                </span>
              )}
            </div>
          </div>
        </section>
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Allowed Ecosystems
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Restrict which package ecosystems are permitted across all
              projects in this tenant. Unchecked ecosystems are blocked by the
              proxy regardless of project policy.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex gap-6">
              {SUPPORTED_ECOSYSTEMS.map((eco) => {
                const checked =
                  allowedEcosystems === null || allowedEcosystems.includes(eco);
                return (
                  <label
                    key={eco}
                    className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!canWriteSettings}
                      onChange={() => toggleEcosystem(eco)}
                      className="h-4 w-4 rounded border-input accent-primary disabled:opacity-50"
                    />
                    {eco}
                  </label>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {allowedEcosystems === null
                ? "All ecosystems are currently allowed."
                : `Restricted to: ${allowedEcosystems.join(", ")}.`}
            </p>
          </div>
        </section>
        {canWriteSettings ? (
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
            {success ? (
              <p className="text-sm text-green-600 dark:text-green-400">
                Saved successfully.
              </p>
            ) : null}
          </div>
        ) : null}
      </form>
    </div>
  );
}
