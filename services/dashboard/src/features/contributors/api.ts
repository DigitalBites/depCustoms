import { apiFetch } from "@/lib/api";
import type {
  ContributorPackagesResponse,
  ContributorPublishersResponse,
  ProjectContributorSummary,
  TenantContributorSummary,
} from "@/features/contributors/types";

export async function fetchTenantContributorSummary(
  tenantId: string,
): Promise<TenantContributorSummary> {
  return (await apiFetch(
    `/v1/tenants/${tenantId}/connectors/contributor/summary`,
  )) as TenantContributorSummary;
}

export async function fetchProjectContributorSummary(
  projectId: string,
): Promise<ProjectContributorSummary> {
  return (await apiFetch(
    `/v1/projects/${projectId}/connectors/contributor/summary`,
  )) as ProjectContributorSummary;
}

export async function fetchTenantContributorPackages(
  tenantId: string,
  params: {
    limit: number;
    offset: number;
    scoreTier?: string;
    minScore?: number;
  },
): Promise<ContributorPackagesResponse> {
  const query = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
  });
  if (params.scoreTier) query.set("score_tier", params.scoreTier);
  if (
    params.minScore !== undefined &&
    params.minScore !== null &&
    !Number.isNaN(params.minScore)
  ) {
    query.set("min_score", String(params.minScore));
  }

  return (await apiFetch(
    `/v1/tenants/${tenantId}/connectors/contributor/packages?${query.toString()}`,
  )) as ContributorPackagesResponse;
}

export async function fetchProjectContributorPackages(
  projectId: string,
  params: {
    limit: number;
    offset: number;
    scoreTier?: string;
    minScore?: number;
  },
): Promise<ContributorPackagesResponse> {
  const query = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
  });
  if (params.scoreTier) query.set("score_tier", params.scoreTier);
  if (
    params.minScore !== undefined &&
    params.minScore !== null &&
    !Number.isNaN(params.minScore)
  ) {
    query.set("min_score", String(params.minScore));
  }

  return (await apiFetch(
    `/v1/projects/${projectId}/connectors/contributor/packages?${query.toString()}`,
  )) as ContributorPackagesResponse;
}

export async function fetchTenantContributorPublishers(
  tenantId: string,
  params: {
    limit: number;
    offset: number;
    ecosystem?: string;
    onlyFirstTime?: boolean;
  },
): Promise<ContributorPublishersResponse> {
  const query = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
  });
  if (params.ecosystem) query.set("ecosystem", params.ecosystem);
  if (params.onlyFirstTime !== undefined) {
    query.set("only_first_time", String(params.onlyFirstTime));
  }

  return (await apiFetch(
    `/v1/tenants/${tenantId}/connectors/contributor/publishers?${query.toString()}`,
  )) as ContributorPublishersResponse;
}
