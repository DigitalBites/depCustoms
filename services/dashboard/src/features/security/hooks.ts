import { useCallback } from "react";
import {
  fetchProjectSecuritySummary,
  fetchTenantSecuritySummary,
} from "@/features/security/api";
import type { SecurityScope, SecuritySummary } from "@/features/security/types";
import { useResource } from "@/hooks/useResource";

export function useSecuritySummary(
  tenantId: string,
  scope: SecurityScope,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const isProjectScope = scope.kind === "project";
  const projectId = isProjectScope ? scope.projectId : null;
  const loadSummary = useCallback(
    () =>
      isProjectScope
        ? fetchProjectSecuritySummary(projectId!)
        : fetchTenantSecuritySummary(tenantId),
    [isProjectScope, projectId, tenantId],
  );
  const { data: summary, loading, error, reload } = useResource<
    SecuritySummary | null
  >(loadSummary, {
    initialData: null,
    enabled,
    errorPrefix: "Failed to load security data",
    resetDataOnDisable: true,
  });

  return {
    summary,
    loading,
    error,
    reload,
  };
}
