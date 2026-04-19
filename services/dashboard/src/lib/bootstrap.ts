import { config } from "@/config";
import { buildApiUrl } from "@/lib/api-path";

export type DashboardBootstrapStatus = {
  ok: boolean;
  state:
    | "waiting_for_db"
    | "schema_not_ready"
    | "auth_unreachable"
    | "no_users"
    | "needs_setup"
    | "ready";
  bundledMode: boolean;
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
  nextStep: "wait_for_runtime" | "sign_in" | "complete_setup" | "done";
  ts: string;
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
