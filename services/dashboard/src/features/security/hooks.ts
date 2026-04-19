import { useCallback, useEffect, useState } from "react";
import {
  fetchProjectSecuritySummary,
  fetchTenantSecuritySummary,
} from "@/features/security/api";
import type { SecurityScope, SecuritySummary } from "@/features/security/types";
import { getUserErrorMessage } from "@/lib/api-error";

export function useSecuritySummary(
  tenantId: string,
  scope: SecurityScope,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const isProjectScope = scope.kind === "project";
  const projectId = isProjectScope ? scope.projectId : null;
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      setSummary(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setSummary(
        isProjectScope
          ? await fetchProjectSecuritySummary(projectId!)
          : await fetchTenantSecuritySummary(tenantId),
      );
    } catch (err) {
      setSummary(null);
      setError(getUserErrorMessage(err, "Failed to load security data"));
    } finally {
      setLoading(false);
    }
  }, [enabled, isProjectScope, projectId, tenantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    summary,
    loading,
    error,
    reload,
  };
}
