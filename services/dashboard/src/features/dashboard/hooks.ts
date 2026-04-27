import { useCallback } from "react";
import {
  fetchTenantMetrics,
  fetchProjectCardData,
} from "@/features/dashboard/api";
import { fetchTenantProjects } from "@/features/projects/api";
import { canPerform } from "@/lib/dashboard-capabilities";
import type { DashboardRole } from "@/lib/dashboard-roles";
import type {
  DashboardProjectData,
  TenantMetrics,
} from "@/features/dashboard/types";
import { useResource } from "@/hooks/useResource";

export function useTenantMetrics(tenantId: string) {
  const loadMetrics = useCallback(() => fetchTenantMetrics(tenantId), [tenantId]);
  const { data, loading, error, reload } = useResource<TenantMetrics>(
    loadMetrics,
    {
      initialData: {
        osvSummary: null,
        violationsSummary: null,
        contributorSummary: null,
      },
      errorPrefix: "Failed to load tenant metrics",
    },
  );

  return { data, loading, error, reload };
}

export function useProjectCards(tenantId: string, role: DashboardRole) {
  const loadCards = useCallback(async () => {
    const includeContributorSummary = canPerform(role, "connectors.read");
    const projects = await fetchTenantProjects(tenantId);
    return Promise.all(
      projects.map((project) =>
        fetchProjectCardData(project, { includeContributorSummary }),
      ),
    );
  }, [role, tenantId]);
  const {
    data: cards,
    loading,
    error: projectsError,
    reload,
  } = useResource<DashboardProjectData[]>(loadCards, {
    initialData: [],
    errorPrefix: "Failed to load projects",
  });

  return { cards, loading, projectsError, reload };
}
