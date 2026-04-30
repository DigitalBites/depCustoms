import Link from "next/link";
import { redirect } from "next/navigation";
import { BootstrapSetupDetail } from "@/components/bootstrap-setup-detail";
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
            )}
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            {bootstrap.state === "needs_setup" &&
            bootstrap.nextStep === "sign_in" &&
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

        <BootstrapSetupDetail
          bootstrap={bootstrap}
          signedIn={signedIn}
          tenantId={tenantId}
          activeTenant={activeTenant}
        />
      </div>
    </div>
  );
}

function renderNextActionText(
  state: DashboardBootstrapStatus["state"],
  nextStep: DashboardBootstrapStatus["nextStep"],
  signedIn: boolean,
) {
  if (state === "auth_unreachable") {
    return "Authentication is unavailable. Restore the auth service before creating the first account or continuing setup.";
  }

  switch (nextStep) {
    case "wait_for_runtime":
      return "The bundled services are still starting or waiting on a dependency. Refresh this page once the runtime checks turn green.";
    case "sign_in":
      if (state === "no_users") {
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
