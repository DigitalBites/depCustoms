import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase-server";
import type { TenantInfo } from "@/components/dashboard-provider";
import {
  canPerform,
  type DashboardCapability,
} from "@/lib/dashboard-capabilities";
import type { DashboardRole } from "@/lib/dashboard-roles";
import { parseAccessTokenMetadata } from "@/lib/jwt-metadata";
import { config } from "@/config";
import { buildApiUrl } from "@/lib/api-path";
import {
  DASHBOARD_ROUTE_CONFIG,
  canAccessDashboardRoute,
} from "@/lib/dashboard-nav";

export type DashboardAuthContext = {
  tenantId: string;
  role: DashboardRole;
  tenants: TenantInfo[];
  userEmail: string;
  authProvider: string;
};

export async function getDashboardAuthContext(): Promise<DashboardAuthContext | null> {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;

  const metadata = parseAccessTokenMetadata(session.access_token);
  if (!metadata) {
    return null;
  }

  const tenantId = metadata.tenantId;
  const role = metadata.role;
  const tenants = metadata.tenants;

  if (!tenantId) return null;

  return {
    tenantId,
    role: role ?? "member",
    tenants,
    userEmail: user.email ?? "Unknown user",
    authProvider: user.app_metadata?.provider ?? "email",
  };
}

export async function requireDashboardAuth(): Promise<DashboardAuthContext> {
  const auth = await getDashboardAuthContext();
  if (!auth) redirect("/login");
  return auth;
}

export async function requireDashboardCapability(
  capability: DashboardCapability,
  fallbackOrOptions:
    | string
    | {
        fallback?: string;
        projectId?: string;
      } = "/projects",
): Promise<DashboardAuthContext> {
  const auth = await requireDashboardAuth();
  const fallback =
    typeof fallbackOrOptions === "string"
      ? fallbackOrOptions
      : (fallbackOrOptions.fallback ?? "/projects");
  const projectId =
    typeof fallbackOrOptions === "string"
      ? undefined
      : fallbackOrOptions.projectId;

  if (projectId && canPerform(auth.role, "projects.read_all")) {
    return auth;
  }

  const hasProjectAccess = projectId
    ? await checkDashboardProjectAccess(auth, projectId, fallback)
    : undefined;

  if (!canPerform(auth.role, capability, { hasProjectAccess })) {
    redirect(fallback);
  }
  return auth;
}

export async function requireDashboardRoute(
  routeKey: keyof typeof DASHBOARD_ROUTE_CONFIG,
  fallback = "/projects",
): Promise<DashboardAuthContext> {
  const auth = await requireDashboardAuth();
  const route = DASHBOARD_ROUTE_CONFIG[routeKey];

  if (!canAccessDashboardRoute(auth.role, route)) {
    redirect(fallback);
  }

  return auth;
}

export async function requireDashboardAccessToken(): Promise<string> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) redirect("/login");
  return session.access_token;
}

function getServerApiBaseUrl(): string {
  return config.apiInternalUrl || config.apiUrl;
}

async function checkDashboardProjectAccess(
  auth: DashboardAuthContext,
  projectId: string,
  fallback = "/projects",
): Promise<boolean> {
  const token = await requireDashboardAccessToken();
  const response = await fetch(
    buildApiUrl(getServerApiBaseUrl(), `/v1/tenants/${auth.tenantId}/projects`),
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    redirect(fallback);
  }

  const data = (await response.json()) as {
    projects?: Array<{ id: string }>;
  };

  return data.projects?.some((project) => project.id === projectId) ?? false;
}
