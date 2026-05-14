import { apiFetch } from "@/lib/api";
import type {
  OsvPackagesResponse,
  OsvSummary,
  UnifiedFindingPackagesResponse,
} from "@/features/findings/types";

export interface SyncProjectOsvResponse {
  newFindings: number;
  reopened: number;
}

export async function fetchTenantOsvSummary(
  tenantId: string,
): Promise<OsvSummary> {
  return (await apiFetch(
    `/v1/tenants/${tenantId}/connectors/osv/summary`,
  )) as OsvSummary;
}

export async function fetchProjectOsvSummary(
  projectId: string,
): Promise<OsvSummary> {
  return (await apiFetch(
    `/v1/projects/${projectId}/connectors/osv/summary`,
  )) as OsvSummary;
}

export async function fetchTenantOsvPackages(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<OsvPackagesResponse> {
  return (await apiFetch(
    `/v1/tenants/${tenantId}/connectors/osv/packages?limit=${limit}&offset=${offset}`,
  )) as OsvPackagesResponse;
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

export async function syncProjectOsv(
  projectId: string,
): Promise<SyncProjectOsvResponse> {
  return (await apiFetch(`/v1/projects/${projectId}/connectors/osv/sync`, {
    method: "POST",
  })) as SyncProjectOsvResponse;
}
