import { apiFetch } from "@/lib/api";
import { POLICY_STATUS } from "@customs/shared-constants";
import type {
  CreatablePolicyStatus,
  EnforcementMode,
} from "@customs/shared-constants";
import type {
  CreatedPolicyResponse,
  Policy,
  PolicyDetailResponse,
  PolicyProjectSummary,
  PolicyRuleViolationCountsResponse,
  Rule,
  ScopeFilter,
  TenantEntitlements,
} from "@/features/policies/types";

export async function fetchPolicyProjects(
  tenantId: string,
): Promise<PolicyProjectSummary[]> {
  const data = (await apiFetch(`/v1/tenants/${tenantId}/projects`)) as {
    projects: PolicyProjectSummary[];
  };
  return data.projects;
}

export async function fetchPolicies(
  tenantId: string,
  scopeFilter: ScopeFilter,
): Promise<Policy[]> {
  const params = new URLSearchParams();
  if (scopeFilter !== "all") {
    params.set("scope", scopeFilter);
  }

  const query = params.toString();
  const path = query
    ? `/v1/tenants/${tenantId}/policies?${query}`
    : `/v1/tenants/${tenantId}/policies`;
  const data = (await apiFetch(path)) as { policies: Policy[] };
  return data.policies;
}

export async function archivePolicy(id: string): Promise<void> {
  await apiFetch(`/v1/policies/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: POLICY_STATUS.ARCHIVED }),
  });
}

export async function deletePolicy(id: string): Promise<void> {
  await apiFetch(`/v1/policies/${id}`, { method: "DELETE" });
}

export async function fetchPolicyDetail(
  id: string,
): Promise<PolicyDetailResponse> {
  return (await apiFetch(`/v1/policies/${id}`)) as PolicyDetailResponse;
}

export async function fetchPolicyRuleViolationCounts(
  id: string,
): Promise<PolicyRuleViolationCountsResponse> {
  return (await apiFetch(
    `/v1/policies/${id}/rule-violation-counts`,
  )) as PolicyRuleViolationCountsResponse;
}

export async function updatePolicy(
  id: string,
  body: {
    name: string;
    description: string | null;
    enforcement_mode: string;
    priority: number;
    status: string;
  },
): Promise<void> {
  await apiFetch(`/v1/policies/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function createTenantPolicy(
  tenantId: string,
  body: {
    name: string;
    description?: string;
    category?: string;
    scope: "global";
    enforcement_mode: EnforcementMode;
    priority: number;
    status: CreatablePolicyStatus;
  },
): Promise<CreatedPolicyResponse> {
  return (await apiFetch(`/v1/tenants/${tenantId}/policies`, {
    method: "POST",
    body: JSON.stringify(body),
  })) as CreatedPolicyResponse;
}

export async function createProjectPolicy(
  projectId: string,
  body: {
    name: string;
    description?: string;
    enforcement_mode: EnforcementMode;
    priority: number;
  },
): Promise<CreatedPolicyResponse> {
  return (await apiFetch(`/v1/projects/${projectId}/policies`, {
    method: "POST",
    body: JSON.stringify(body),
  })) as CreatedPolicyResponse;
}

export async function fetchTenantEntitlements(
  tenantId: string,
): Promise<TenantEntitlements> {
  const data = (await apiFetch(`/v1/tenants/${tenantId}/entitlements`)) as {
    entitlements: TenantEntitlements;
  };
  return data.entitlements;
}

export async function createPolicyRule(
  policyId: string,
  body: {
    name: string;
    description?: string;
    target_entity: string;
    condition: unknown;
    action: unknown;
    enabled: boolean;
  },
): Promise<void> {
  await apiFetch(`/v1/policies/${policyId}/rules`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchRule(id: string): Promise<{ rule: Rule }> {
  return (await apiFetch(`/v1/rules/${id}`)) as { rule: Rule };
}

export async function updateRule(
  id: string,
  body: {
    name: string;
    description: string | null;
    target_entity: string;
    condition: unknown;
    action: unknown;
    enabled: boolean;
  },
): Promise<void> {
  await apiFetch(`/v1/rules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteRule(id: string): Promise<void> {
  await apiFetch(`/v1/rules/${id}`, { method: "DELETE" });
}
