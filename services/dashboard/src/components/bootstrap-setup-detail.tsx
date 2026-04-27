"use client";

import { useState } from "react";
import { SetupFirstUserForm } from "@/components/setup-first-user-form";
import { SetupTenantForm } from "@/components/setup-tenant-form";
import {
  getBootstrapDetailStatus,
  type DashboardBootstrapDetailStatus,
  type DashboardBootstrapStatus,
} from "@/lib/bootstrap";
import type { TokenTenantInfo } from "@/lib/jwt-metadata";

type BootstrapSetupDetailProps = {
  bootstrap: DashboardBootstrapStatus;
  signedIn: boolean;
  tenantId: string | null;
  activeTenant: TokenTenantInfo | null;
};

export function BootstrapSetupDetail({
  bootstrap,
  signedIn,
  tenantId,
  activeTenant,
}: BootstrapSetupDetailProps) {
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [details, setDetails] = useState<DashboardBootstrapDetailStatus | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const nextDetails = await getBootstrapDetailStatus(bootstrapSecret);
      setDetails(nextDetails);
    } catch (err) {
      setDetails(null);
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load setup diagnostics.",
      );
    } finally {
      setLoading(false);
    }
  }

  const canCreateFirstUser =
    details?.state === "no_users" &&
    !signedIn &&
    details.checks.authReachable &&
    !details.checks.usersExist;
  const canRenameTenant =
    Boolean(
      signedIn &&
        details?.checks.placeholderTenantExists &&
        tenantId &&
        activeTenant,
    );

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-medium text-foreground">
        Operator diagnostics
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Enter the bootstrap secret to unlock the detailed setup checks and any
        protected setup actions for this instance.
      </p>

      <form onSubmit={loadDetails} className="mt-4 space-y-3">
        <label className="block">
          <span className="text-sm font-medium text-foreground">
            Bootstrap secret
          </span>
          <input
            type="password"
            value={bootstrapSecret}
            onChange={(event) => setBootstrapSecret(event.target.value)}
            placeholder="Paste BOOTSTRAP_FIRST_USER_SECRET"
            required
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            The secret is kept only in memory for this setup flow and is not
            stored in the dashboard.
          </p>
        </label>

        <button
          type="submit"
          disabled={loading || !bootstrapSecret}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? "Loading diagnostics…" : "Load detailed setup checks"}
        </button>
      </form>

      {error ? (
        <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {details ? (
        <div className="mt-6 space-y-6">
          {canCreateFirstUser ? (
            <div>
              <h3 className="text-sm font-medium text-foreground">
                Create first account
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                The auth service is reachable and the instance does not have a
                user yet. Create the first account to establish the initial
                owner.
              </p>
              <SetupFirstUserForm
                bootstrapSecret={bootstrapSecret}
                onBootstrapSecretChange={setBootstrapSecret}
                showBootstrapSecretField={false}
              />
            </div>
          ) : null}

          {details.state === "auth_unreachable" ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              Authentication is currently unavailable. First-user bootstrap is
              disabled until the auth service is reachable again.
            </div>
          ) : null}

          {canRenameTenant && tenantId && activeTenant ? (
            <div>
              <h3 className="text-sm font-medium text-foreground">
                Complete tenant setup
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Rename the placeholder tenant to finish the initial ownership
                claim for this instance.
              </p>
              <SetupTenantForm
                tenantId={tenantId}
                initialName={activeTenant.tenant_name}
              />
            </div>
          ) : null}

          <div>
            <h3 className="text-sm font-medium text-foreground">Checks</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <StatusRow label="Database ready" value={details.checks.dbReady} />
              <StatusRow label="Schema ready" value={details.checks.schemaReady} />
              <StatusRow
                label="Auth reachable"
                value={details.checks.authReachable}
              />
              <StatusRow label="Users exist" value={details.checks.usersExist} />
              <StatusRow
                label="Owner membership exists"
                value={details.checks.ownerMembershipExists}
              />
              <StatusRow
                label="Tenant exists"
                value={details.checks.tenantExists}
              />
              <StatusRow
                label="Placeholder tenant exists"
                value={details.checks.placeholderTenantExists}
              />
              <StatusRow
                label="Bundled proxy configured"
                value={details.checks.bundledProxyConfigured}
              />
              <StatusRow
                label="Bundled proxy registered"
                value={details.checks.bundledProxyRegistered}
              />
            </div>
          </div>
        </div>
      ) : bootstrap.state === "no_users" ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Load the detailed checks to create the first account.
        </p>
      ) : null}
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
      <span className="text-sm text-foreground">{label}</span>
      <span
        className={`text-xs font-medium ${value ? "text-emerald-600" : "text-amber-600"}`}
      >
        {value ? "ok" : "pending"}
      </span>
    </div>
  );
}
