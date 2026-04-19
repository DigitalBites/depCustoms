import { apiFetch } from "@/lib/api";
import type {
  OsvPackagesResponse,
  OsvSummary,
  UnifiedFindingPackagesResponse,
} from "@/features/findings/types";
import type { SecuritySummary } from "@/features/security/types";
import type { ViolationEntitiesResponse } from "@/features/violations/types";

export async function fetchTenantSecuritySummary(
  tenantId: string,
): Promise<SecuritySummary> {
  return (await apiFetch(
    `/v1/tenants/${tenantId}/security-summary`,
  )) as SecuritySummary;
}

export async function fetchProjectSecuritySummary(
  projectId: string,
): Promise<SecuritySummary> {
  return (await apiFetch(
    `/v1/projects/${projectId}/security-summary`,
  )) as SecuritySummary;
}

export async function fetchProjectOsvSummary(
  projectId: string,
): Promise<OsvSummary> {
  return (await apiFetch(
    `/v1/projects/${projectId}/connectors/osv/summary`,
  )) as OsvSummary;
}

export async function fetchProjectOsvPackages(
  projectId: string,
  limit: number,
  offset: number,
): Promise<OsvPackagesResponse> {
  return (await apiFetch(
    `/v1/projects/${projectId}/connectors/osv/packages?limit=${limit}&offset=${offset}`,
  )) as OsvPackagesResponse;
}

export async function fetchTenantFindingPackages(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<UnifiedFindingPackagesResponse> {
  return (await apiFetch(
    `/v1/tenants/${tenantId}/findings/packages?limit=${limit}&offset=${offset}`,
  )) as UnifiedFindingPackagesResponse;
}

export async function fetchProjectFindingPackages(
  projectId: string,
  limit: number,
  offset: number,
): Promise<UnifiedFindingPackagesResponse> {
  return (await apiFetch(
    `/v1/projects/${projectId}/findings/packages?limit=${limit}&offset=${offset}`,
  )) as UnifiedFindingPackagesResponse;
}

export async function fetchTenantViolationEntities(
  tenantId: string,
  limit: number,
  offset: number,
  status: "all" | "open" | "resolved" | "suppressed",
): Promise<ViolationEntitiesResponse> {
  return (await apiFetch(
    `/v1/tenants/${tenantId}/violations/entities?limit=${limit}&offset=${offset}&status=${status}`,
  )) as ViolationEntitiesResponse;
}

export async function fetchProjectViolationEntities(
  projectId: string,
  limit: number,
  offset: number,
  status: "all" | "open" | "resolved" | "suppressed",
): Promise<ViolationEntitiesResponse> {
  return (await apiFetch(
    `/v1/projects/${projectId}/violations/entities?limit=${limit}&offset=${offset}&status=${status}`,
  )) as ViolationEntitiesResponse;
}
