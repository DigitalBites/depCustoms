import { useEffect, useState } from "react";
import {
  fetchProjectContributorSummary,
  fetchTenantContributorSummary,
} from "@/features/contributors/api";
import type {
  ProjectContributorSummary,
  TenantContributorSummary,
} from "@/features/contributors/types";
import { getUserErrorMessage } from "@/lib/api-error";

type ContributorSummaryScope =
  | { kind: "tenant"; tenantId: string }
  | { kind: "project"; projectId: string };

export function useContributorSummary(
  scope: ContributorSummaryScope,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const isProjectScope = scope.kind === "project";
  const scopeId = isProjectScope ? scope.projectId : scope.tenantId;
  const [summary, setSummary] = useState<
    TenantContributorSummary | ProjectContributorSummary | null
  >(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!enabled) {
        setSummary(null);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const data = isProjectScope
          ? await fetchProjectContributorSummary(scopeId)
          : await fetchTenantContributorSummary(scopeId);
        if (cancelled) return;
        setSummary(data);
      } catch (err) {
        if (cancelled) return;
        setSummary(null);
        setError(
          getUserErrorMessage(err, "Failed to load contributor risk data"),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, isProjectScope, scopeId]);

  return { summary, loading, error };
}
