import type { OsvSummary } from "@/features/findings/types";
import type { SecuritySummary } from "@/features/security/types";
import type { ProjectSummary } from "@/features/projects/types";
import type { ViolationsSummary } from "@/features/violations/types";
import type {
  ProjectContributorSummary,
  TenantContributorSummary,
} from "@/features/contributors/types";

export interface TenantMetrics {
  osvSummary: OsvSummary | null;
  violationsSummary: ViolationsSummary | null;
  contributorSummary: TenantContributorSummary | null;
}

export interface DashboardProjectData {
  project: ProjectSummary;
  osvSummary: OsvSummary | null;
  securitySummary: SecuritySummary | null;
  contributorSummary: ProjectContributorSummary | null;
  /** Set when one or both per-project fetches failed. */
  error?: string;
}
