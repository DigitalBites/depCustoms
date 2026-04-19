import {
  normalizeDashboardRole,
  type DashboardRole,
} from "@/lib/dashboard-roles";

export interface TokenTenantInfo {
  tenant_id: string;
  tenant_name: string;
  role: DashboardRole;
}

export interface DashboardJwtMetadata {
  tenantId?: string;
  role?: DashboardRole;
  tenants: TokenTenantInfo[];
}

function decodeBase64Url(segment: string): string | null {
  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(segment, "base64url").toString();
    }

    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    return atob(normalized + padding);
  } catch {
    return null;
  }
}

export function parseAccessTokenMetadata(
  accessToken: string,
): DashboardJwtMetadata | null {
  const segments = accessToken.split(".");
  if (segments.length < 2 || !segments[1]) {
    return null;
  }

  const payloadJson = decodeBase64Url(segments[1]);
  if (!payloadJson) {
    return null;
  }

  try {
    const payload = JSON.parse(payloadJson) as {
      app_metadata?: {
        tenant_id?: string;
        role?: string;
        tenants?: unknown;
      };
    };

    const rawTenants = payload.app_metadata?.tenants;
    const tenants = Array.isArray(rawTenants)
      ? rawTenants.filter(isTokenTenantInfo)
      : [];

    return {
      tenantId: payload.app_metadata?.tenant_id,
      role: normalizeDashboardRole(payload.app_metadata?.role),
      tenants,
    };
  } catch {
    return null;
  }
}

function isTokenTenantInfo(value: unknown): value is TokenTenantInfo {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.tenant_id === "string" &&
    typeof candidate.tenant_name === "string" &&
    typeof candidate.role === "string" &&
    normalizeDashboardRole(candidate.role) !== undefined
  );
}
