import { apiFetch } from "@/lib/api";
import { getUserErrorMessage } from "@/lib/api-error";
import {
  fetchProjectContributorSummary,
  fetchTenantContributorSummary,
} from "@/features/contributors/api";
import {
  fetchProjectSecuritySummary,
} from "@/features/security/api";
import {
  fetchProjectOsvSummary,
  fetchTenantOsvSummary as fetchTenantFindingsOsvSummary,
} from "@/features/findings/api";
import type { OsvSummary } from "@/features/findings/types";
import type { ViolationsSummary } from "@/features/violations/types";
import type { ProjectSummary } from "@/features/projects/types";
import type {
  DashboardProjectData,
  TenantMetrics,
} from "@/features/dashboard/types";

export async function fetchTenantOsvSummary(
  tenantId: string,
): Promise<OsvSummary> {
  return fetchTenantFindingsOsvSummary(tenantId);
}

export async function fetchTenantViolationsSummary(
  tenantId: string,
): Promise<ViolationsSummary> {
  return (await apiFetch(
    `/v1/tenants/${tenantId}/violations/summary`,
  )) as ViolationsSummary;
}

export async function fetchTenantMetrics(
  tenantId: string,
): Promise<TenantMetrics> {
  const [osvResult, violationsResult, contributorResult] =
    await Promise.allSettled([
      fetchTenantOsvSummary(tenantId),
      fetchTenantViolationsSummary(tenantId),
      fetchTenantContributorSummary(tenantId),
    ]);

  return {
    osvSummary: osvResult.status === "fulfilled" ? osvResult.value : null,
    violationsSummary:
      violationsResult.status === "fulfilled" ? violationsResult.value : null,
    contributorSummary:
      contributorResult.status === "fulfilled" ? contributorResult.value : null,
  };
}

/**
 * Loads both the OSV summary and security summary for a single project.
 * Uses Promise.allSettled so a partial failure still returns whatever data is available.
 */
export async function fetchProjectCardData(
  project: ProjectSummary,
  options: { includeContributorSummary?: boolean } = {},
): Promise<DashboardProjectData> {
  const { includeContributorSummary = false } = options;
  const [osvResult, securityResult, contributorResult] =
    await Promise.allSettled([
      fetchProjectOsvSummary(project.id),
      fetchProjectSecuritySummary(project.id),
      includeContributorSummary
        ? fetchProjectContributorSummary(project.id)
        : Promise.resolve(null),
    ]);

  const osvSummary = osvResult.status === "fulfilled" ? osvResult.value : null;
  const securitySummary =
    securityResult.status === "fulfilled" ? securityResult.value : null;
  const contributorSummary =
    contributorResult.status === "fulfilled" ? contributorResult.value : null;

  const errors: string[] = [];
  if (osvResult.status === "rejected") {
    errors.push(
      getUserErrorMessage(osvResult.reason, "Failed to load package data"),
    );
  }
  if (securityResult.status === "rejected") {
    errors.push(
      getUserErrorMessage(
        securityResult.reason,
        "Failed to load security data",
      ),
    );
  }
  if (contributorResult.status === "rejected") {
    errors.push(
      getUserErrorMessage(
        contributorResult.reason,
        "Failed to load contributor data",
      ),
    );
  }

  return {
    project,
    osvSummary,
    securitySummary,
    contributorSummary,
    error: errors.length > 0 ? errors.join(" · ") : undefined,
  };
}
