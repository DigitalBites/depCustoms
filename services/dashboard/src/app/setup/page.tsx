import Link from "next/link";
import { redirect } from "next/navigation";
import { SetupFirstUserForm } from "@/components/setup-first-user-form";
import { SetupTenantForm } from "@/components/setup-tenant-form";
import {
  getBootstrapStatus,
  type DashboardBootstrapStatus,
} from "@/lib/bootstrap";
import { parseAccessTokenMetadata } from "@/lib/jwt-metadata";
import { createServerClient } from "@/lib/supabase-server";

export default async function SetupPage() {
  const bootstrap = await getBootstrapStatus();
  if (bootstrap.state === "ready") {
    redirect("/dashboard");
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const signedIn = Boolean(user);
  const canCreateFirstUser =
    !bootstrap.checks.usersExist && !signedIn && bootstrap.checks.authReachable;
  const metadata = session?.access_token
    ? parseAccessTokenMetadata(session.access_token)
    : null;
  const tenantId = metadata?.tenantId ?? null;
  const activeTenant =
    metadata?.tenants.find((tenant) => tenant.tenant_id === tenantId) ?? null;

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Instance setup
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The instance is not ready for normal dashboard use yet. Complete the
            next step below, then continue into the product.
          </p>
        </div>

        <div className="mb-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">
                Bootstrap state
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                <code>{bootstrap.state}</code>
              </p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              Updated {new Date(bootstrap.ts).toLocaleString()}
            </div>
          </div>
        </div>

        <div className="mb-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-medium text-foreground">Next action</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {renderNextActionText(
              bootstrap.state,
              bootstrap.nextStep,
              signedIn,
              bootstrap.checks.usersExist,
              bootstrap.checks.authReachable,
            )}
          </p>

          {canCreateFirstUser ? (
            <SetupFirstUserForm />
          ) : null}

          {!bootstrap.checks.authReachable ? (
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              Authentication is currently unavailable. First-user bootstrap is
              disabled until the auth service is reachable again.
            </div>
          ) : null}

          {signedIn &&
          bootstrap.checks.placeholderTenantExists &&
          tenantId &&
          activeTenant ? (
            <SetupTenantForm
              tenantId={tenantId}
              initialName={activeTenant.tenant_name}
            />
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            {bootstrap.checks.usersExist &&
            !bootstrap.checks.ownerMembershipExists &&
            !signedIn ? (
              <Link
                href="/login"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Continue to login
              </Link>
            ) : null}

            <Link
              href="/setup"
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground"
            >
              Refresh status
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-medium text-foreground">Checks</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <StatusRow
              label="Database ready"
              value={bootstrap.checks.dbReady}
            />
            <StatusRow
              label="Schema ready"
              value={bootstrap.checks.schemaReady}
            />
            <StatusRow
              label="Auth reachable"
              value={bootstrap.checks.authReachable}
            />
            <StatusRow
              label="Users exist"
              value={bootstrap.checks.usersExist}
            />
            <StatusRow
              label="Owner membership exists"
              value={bootstrap.checks.ownerMembershipExists}
            />
            <StatusRow
              label="Tenant exists"
              value={bootstrap.checks.tenantExists}
            />
            <StatusRow
              label="Placeholder tenant exists"
              value={bootstrap.checks.placeholderTenantExists}
            />
            <StatusRow
              label="Bundled proxy configured"
              value={bootstrap.checks.bundledProxyConfigured}
            />
            <StatusRow
              label="Bundled proxy registered"
              value={bootstrap.checks.bundledProxyRegistered}
            />
          </div>
        </div>
      </div>
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

function renderNextActionText(
  state: DashboardBootstrapStatus["state"],
  nextStep: "wait_for_runtime" | "sign_in" | "complete_setup" | "done",
  signedIn: boolean,
  usersExist: boolean,
  authReachable: boolean,
) {
  if (state === "auth_unreachable" || !authReachable) {
    return "Authentication is unavailable. Restore the auth service before creating the first account or continuing setup.";
  }

  switch (nextStep) {
    case "wait_for_runtime":
      return "The bundled services are still starting or waiting on a dependency. Refresh this page once the runtime checks turn green.";
    case "sign_in":
      if (!usersExist) {
        return "Create the first account to establish the instance owner, then continue to login.";
      }
      return signedIn
        ? "The instance still needs its first owner claim. Continue into the dashboard after your session is established."
        : "Login with the first account to claim the bundled tenant and continue setup.";
    case "complete_setup":
      return signedIn
        ? "Finish the remaining setup steps in the dashboard."
        : "Sign in to finish the remaining setup steps.";
    case "done":
      return "The instance is ready.";
  }
}
