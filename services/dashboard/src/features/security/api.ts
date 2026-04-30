import { apiFetch } from "@/lib/api";
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
