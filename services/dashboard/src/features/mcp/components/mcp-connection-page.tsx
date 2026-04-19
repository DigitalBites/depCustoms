"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { useState } from "react";
import { useDashboard } from "@/components/dashboard-provider";
import { InlineError } from "@/components/feedback/inline-error";
import { PageLoading } from "@/components/feedback/page-loading";
import { PageHeader } from "@/components/layout/page-header";
import { CopyField } from "@/components/ui/copy-field";
import {
  useMcpConnectionBootstrap,
  useMcpEntitlement,
} from "@/features/mcp/hooks";
import type { McpClientId, McpConnectionBootstrap } from "@/features/mcp/types";
import { canPerform } from "@/lib/dashboard-capabilities";

const CLIENT_OPTIONS: { id: McpClientId; label: string }[] = [
  { id: "codex", label: "Codex" },
  { id: "claude_code", label: "Claude Code" },
];

export function McpConnectionPage() {
  const { tenantId, tenants, role } = useDashboard();
  const canWriteSettings = canPerform(role, "settings.write");
  const currentTenant = tenants.find((tenant) => tenant.tenant_id === tenantId);
  const [clientId, setClientId] = useState<McpClientId>("codex");
  const entitlement = useMcpEntitlement();
  const bootstrap = useMcpConnectionBootstrap();

  const pageError = entitlement.error ?? bootstrap.error;

  async function handlePrepare(event: FormEvent) {
    event.preventDefault();
    await bootstrap.prepare({
      clientName: clientId,
    });
  }

  if (entitlement.loading) {
    return <PageLoading />;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="MCP"
        description="Prepare OAuth-backed MCP connections for developer tools like Codex and Claude Code."
        className="mb-0"
      />

      <InlineError message={pageError} />

      {!entitlement.enabled ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">
            MCP is disabled for this tenant
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {canWriteSettings ? (
              <>
                Enable MCP in{" "}
                <Link
                  href="/settings"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  tenant entitlements
                </Link>{" "}
                before creating connections.
              </>
            ) : (
              "Ask someone with tenant settings access to enable MCP before creating connections."
            )}
          </p>
        </section>
      ) : (
        <>
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-semibold text-foreground">
              Prepare connection
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Connections are user-bound, scoped to the current tenant, and use
              the normal OAuth login flow.
            </p>
            <form
              onSubmit={handlePrepare}
              className="mt-5 grid gap-4 md:grid-cols-2"
            >
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">
                  Tenant
                </span>
                <div className="flex min-h-10 w-full items-center rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                  {currentTenant?.tenant_name ?? tenantId}
                </div>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">
                  Client
                </span>
                <div className="relative">
                  <select
                    value={clientId}
                    onChange={(event) =>
                      setClientId(event.target.value as McpClientId)
                    }
                    className="min-h-10 w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {CLIENT_OPTIONS.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.label}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground">
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
              </label>
              <div className="md:col-span-2 flex items-center gap-3">
                <button
                  type="submit"
                  disabled={bootstrap.loading}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {bootstrap.loading ? "Preparing…" : "Prepare MCP connection"}
                </button>
                <span className="text-xs text-muted-foreground">
                  This session will authenticate as your signed-in user.
                </span>
              </div>
            </form>
          </section>

          {bootstrap.connection ? (
            <McpConnectionDetails
              connection={bootstrap.connection}
              clientId={clientId}
              tenantName={currentTenant?.tenant_name ?? tenantId}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function McpConnectionDetails({
  connection,
  clientId,
  tenantName,
}: {
  connection: McpConnectionBootstrap;
  clientId: McpClientId;
  tenantName: string;
}) {
  const setupSnippet =
    clientId === "codex"
      ? buildCodexSnippet(connection)
      : buildClaudeCodeSnippet(connection);

  return (
    <>
      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Connection details
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use this endpoint with an OAuth-capable MCP client. The client will
            send you through the normal sign-in flow when it needs to
            authenticate or refresh.
          </p>
        </div>
        <div className="space-y-2">
          <CopyField
            label="ENDPOINT_URL"
            value={connection.endpoint_url}
            separator="="
          />
          <CopyField
            label="AUTHORIZATION_URL"
            value={connection.auth.authorization_url}
            separator="="
          />
          <CopyField
            label="TOKEN_URL"
            value={connection.auth.token_url}
            separator="="
          />
          <CopyField label="TENANT" value={tenantName} separator="=" />
          <CopyField
            label="PROTOCOL_VERSION"
            value={connection.protocol_version}
            separator="="
          />
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {clientId === "codex" ? "Codex setup" : "Claude Code setup"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These samples assume the client supports remote MCP with OAuth.
            Customs remains a generic MCP server; this is just the tested
            starter configuration.
          </p>
        </div>
        <pre className="overflow-x-auto rounded-lg bg-muted/60 p-4 text-xs text-foreground">
          <code>{setupSnippet}</code>
        </pre>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Relogin behavior
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Access tokens follow the same GoTrue policy as the dashboard. The
            MCP client should refresh normally while your auth session is valid.
            When the session expires, the client should send you back through
            OAuth sign-in again.
          </p>
        </div>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>Access token target: 1 hour</li>
          <li>Active session timebox target: 8 hours</li>
          <li>
            Turning MCP off for the tenant takes effect as existing tokens
            expire
          </li>
        </ul>
      </section>
    </>
  );
}

function buildCodexSnippet(connection: McpConnectionBootstrap) {
  return [
    `codex mcp add customs --url ${connection.endpoint_url}`,
    "",
    "# When prompted, sign in through the browser OAuth flow.",
    `# Tenant: ${connection.tenant_id}`,
  ].join("\n");
}

function buildClaudeCodeSnippet(connection: McpConnectionBootstrap) {
  return [
    "{",
    '  "mcpServers": {',
    '    "customs": {',
    `      "url": "${connection.endpoint_url}"`,
    "    }",
    "  }",
    "}",
    "",
    "# Claude Code should prompt for the browser OAuth flow on connect.",
    `# Tenant: ${connection.tenant_id}`,
  ].join("\n");
}
