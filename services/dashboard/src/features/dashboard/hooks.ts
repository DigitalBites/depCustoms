import { useCallback, useEffect, useState } from "react";
import {
  fetchTenantMetrics,
  fetchProjectCardData,
} from "@/features/dashboard/api";
import { fetchTenantProjects } from "@/features/projects/api";
import { getUserErrorMessage } from "@/lib/api-error";
import { canPerform } from "@/lib/dashboard-capabilities";
import type { DashboardRole } from "@/lib/dashboard-roles";
import type {
  DashboardProjectData,
  TenantMetrics,
} from "@/features/dashboard/types";

export function useTenantMetrics(tenantId: string) {
  const [data, setData] = useState<TenantMetrics>({
    osvSummary: null,
    violationsSummary: null,
    contributorSummary: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchTenantMetrics(tenantId)
      .then(setData)
      .catch((err) =>
        setError(getUserErrorMessage(err, "Failed to load tenant metrics")),
      )
      .finally(() => setLoading(false));
  }, [tenantId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload };
}

export function useProjectCards(tenantId: string, role: DashboardRole) {
  const [cards, setCards] = useState<DashboardProjectData[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setProjectsError(null);
    const includeContributorSummary = canPerform(role, "connectors.read");

    fetchTenantProjects(tenantId)
      .then((projects) => {
        // Fan out to all projects in parallel; individual card errors are surfaced per-card
        return Promise.all(
          projects.map((project) =>
            fetchProjectCardData(project, { includeContributorSummary }),
          ),
        );
      })
      .then(setCards)
      .catch((err) =>
        setProjectsError(getUserErrorMessage(err, "Failed to load projects")),
      )
      .finally(() => setLoading(false));
  }, [role, tenantId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { cards, loading, projectsError, reload };
}
