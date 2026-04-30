import { config } from "@/config";
import { buildApiUrl } from "@/lib/api-path";

export type DashboardBootstrapState =
  | "waiting_for_db"
  | "schema_not_ready"
  | "auth_unreachable"
  | "no_users"
  | "needs_setup"
  | "ready";

export type DashboardBootstrapNextStep =
  | "wait_for_runtime"
  | "sign_in"
  | "complete_setup"
  | "done";

export type DashboardBootstrapSetup = {
  firstTenantEnabled: boolean;
  firstProxyEnabled: boolean;
  defaultPoliciesEnabled: boolean;
};

export type DashboardBootstrapStatus = {
  ok: boolean;
  state: DashboardBootstrapState;
  bundledMode: boolean;
  setup: DashboardBootstrapSetup;
  nextStep: DashboardBootstrapNextStep;
  ts: string;
};

export type DashboardBootstrapDetailStatus = DashboardBootstrapStatus & {
  checks: {
    dbReady: boolean;
    schemaReady: boolean;
    authReachable: boolean;
    usersExist: boolean;
    ownerMembershipExists: boolean;
    tenantExists: boolean;
    placeholderTenantExists: boolean;
    bundledProxyConfigured: boolean;
    bundledProxyRegistered: boolean;
  };
};

export async function getBootstrapStatus(): Promise<DashboardBootstrapStatus> {
  const baseUrl = config.apiInternalUrl || config.apiUrl;
  const response = await fetch(
    buildApiUrl(baseUrl, "/internal/bootstrap/status"),
    {
      cache: "no-store",
    },
  );

  if (!response.ok && response.status !== 503) {
    throw new Error(`Bootstrap status request failed with ${response.status}`);
  }

  return (await response.json()) as DashboardBootstrapStatus;
}

export async function getBootstrapDetailStatus(
  bootstrapSecret: string,
): Promise<DashboardBootstrapDetailStatus> {
  const response = await fetch("/internal/bootstrap/status/detail", {
    cache: "no-store",
    headers: {
      "x-bootstrap-secret": bootstrapSecret,
    },
  });

  if (!response.ok && response.status !== 503) {
    const payload = (await response.json().catch(() => null)) as
      | {
          error?: { message?: string; detail?: string | null };
        }
      | null;
    throw new Error(
      payload?.error?.detail ||
        payload?.error?.message ||
        `Bootstrap detail request failed with ${response.status}`,
    );
  }

  return (await response.json()) as DashboardBootstrapDetailStatus;
}
