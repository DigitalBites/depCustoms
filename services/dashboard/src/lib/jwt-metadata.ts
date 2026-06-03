import {
  normalizeDashboardRole,
  type DashboardRole,
} from "@/lib/dashboard-roles";
import {
  TENANT_KIND,
  TENANT_KINDS,
  type TenantKind,
} from "@customs/shared-constants";

export interface TokenTenantInfo {
  tenant_id: string;
  tenant_name: string;
  tenant_kind: TenantKind;
  role: DashboardRole;
}

export interface DashboardJwtMetadata {
  tenantId?: string;
  tenantKind?: TenantKind;
  role?: DashboardRole;
  tenants: TokenTenantInfo[];
}

export interface UsableDashboardJwtMetadata extends DashboardJwtMetadata {
  tenantId: string;
  tenantKind: TenantKind;
  role: DashboardRole;
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
        tenant_kind?: string;
        role?: string;
        tenants?: unknown;
      };
    };

    const rawTenants = payload.app_metadata?.tenants;
    const tenants = Array.isArray(rawTenants)
      ? rawTenants.map(toTokenTenantInfo).filter(isTokenTenantInfo)
      : [];

    return {
      tenantId: payload.app_metadata?.tenant_id,
      tenantKind:
        normalizeTenantKind(payload.app_metadata?.tenant_kind) ??
        TENANT_KIND.CUSTOMER,
      role: normalizeDashboardRole(payload.app_metadata?.role),
      tenants,
    };
  } catch {
    return null;
  }
}

function toTokenTenantInfo(value: unknown): TokenTenantInfo | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const role =
    typeof candidate.role === "string"
      ? normalizeDashboardRole(candidate.role)
      : undefined;
  if (
    typeof candidate.tenant_id !== "string" ||
    typeof candidate.tenant_name !== "string" ||
    !role
  ) {
    return null;
  }

  return {
    tenant_id: candidate.tenant_id,
    tenant_name: candidate.tenant_name,
    tenant_kind:
      normalizeTenantKind(candidate.tenant_kind) ?? TENANT_KIND.CUSTOMER,
    role,
  };
}

function isTokenTenantInfo(value: TokenTenantInfo | null): value is TokenTenantInfo {
  return value !== null;
}

function normalizeTenantKind(value: unknown): TenantKind | undefined {
  return typeof value === "string" && TENANT_KINDS.includes(value as TenantKind)
    ? (value as TenantKind)
    : undefined;
}

export function hasUsableDashboardJwtMetadata(
  metadata: DashboardJwtMetadata | null,
): metadata is UsableDashboardJwtMetadata {
  return Boolean(metadata?.tenantId && metadata.tenantKind && metadata.role);
}
