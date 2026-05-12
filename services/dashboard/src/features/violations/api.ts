import { apiFetch } from "@/lib/api";
import type {
  WritableFindingStatus,
  WritableViolationStatus,
} from "@customs/shared-constants";
import type {
  BulkViolationStatusResponse,
  ViolationDetailResponse,
  ViolationsListResponse,
  ViolationsSummary,
} from "@/features/violations/types";

export async function fetchViolationsSummary(input: {
  tenantId: string;
  projectId?: string;
}): Promise<ViolationsSummary> {
  const url = input.projectId
    ? `/v1/projects/${input.projectId}/violations/summary`
    : `/v1/tenants/${input.tenantId}/violations/summary`;

  return (await apiFetch(url)) as ViolationsSummary;
}

export async function fetchViolations(input: {
  tenantId: string;
  projectId?: string;
  policyId?: string;
  ruleId?: string;
  limit: number;
  offset: number;
  statusFilter: string;
  severityFilter: string;
  entityFilter: string;
}): Promise<ViolationsListResponse> {
  const params = new URLSearchParams({
    limit: String(input.limit),
    offset: String(input.offset),
  });

  if (input.statusFilter !== "all") params.set("status", input.statusFilter);
  if (input.severityFilter !== "all")
    params.set("severity", input.severityFilter);
  if (input.entityFilter.trim())
    params.set("search", input.entityFilter.trim());
  if (input.ruleId) params.set("rule_id", input.ruleId);

  let url: string;
  if (input.projectId) {
    url = `/v1/projects/${input.projectId}/violations?${params}`;
  } else if (input.policyId) {
    url = `/v1/policies/${input.policyId}/violations?${params}`;
  } else {
    url = `/v1/tenants/${input.tenantId}/violations?${params}`;
  }

  return (await apiFetch(url)) as ViolationsListResponse;
}

export async function fetchViolationDetail(
  violationId: string,
): Promise<ViolationDetailResponse> {
  return (await apiFetch(
    `/v1/violations/${violationId}`,
  )) as ViolationDetailResponse;
}

export async function updateViolationStatus(
  violationId: string,
  status: WritableViolationStatus,
  note: string,
): Promise<ViolationDetailResponse> {
  return (await apiFetch(`/v1/violations/${violationId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, status_note: note || null }),
  })) as ViolationDetailResponse;
}

export async function updateBulkViolationStatus(input: {
  violationIds: string[];
  status: WritableViolationStatus;
  note: string;
}): Promise<BulkViolationStatusResponse> {
  return (await apiFetch("/v1/violations/bulk-status", {
    method: "PATCH",
    body: JSON.stringify({
      violation_ids: input.violationIds,
      status: input.status,
      status_note: input.note.trim() || null,
    }),
  })) as BulkViolationStatusResponse;
}

export async function updateFindingStatus(input: {
  projectId: string;
  findingId: string;
  status: WritableFindingStatus;
  note: string;
}): Promise<void> {
  await apiFetch(
    `/v1/projects/${input.projectId}/findings/${input.findingId}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: input.status,
        status_note: input.note || null,
      }),
    },
  );
}
