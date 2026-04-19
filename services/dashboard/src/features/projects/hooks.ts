import { useCallback, useEffect, useState } from "react";
import { useDashboard } from "@/components/dashboard-provider";
import {
  createProject,
  deleteProject,
  fetchTenantProjects,
} from "@/features/projects/api";
import type { ProjectSummary } from "@/features/projects/types";
import { getUserErrorMessage } from "@/lib/api-error";

export function useTenantProjects({
  enabled = true,
  suppressErrors = false,
}: {
  enabled?: boolean;
  suppressErrors?: boolean;
} = {}) {
  const { tenantId } = useDashboard();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setProjects(await fetchTenantProjects(tenantId));
    } catch (err) {
      setProjects([]);
      if (!suppressErrors) {
        setError(getUserErrorMessage(err, "Failed to load projects"));
      }
    } finally {
      setLoading(false);
    }
  }, [enabled, suppressErrors, tenantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    projects,
    loading,
    error,
    setError,
    reload,
  };
}

export function useProjectMutations({
  tenantId,
  onError,
}: {
  tenantId: string;
  onError: (message: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleCreate(name: string) {
    setCreating(true);
    try {
      await createProject(tenantId, name);
      return true;
    } catch (err) {
      onError(getUserErrorMessage(err, "Failed to create project"));
      return false;
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(projectId: string, projectName: string) {
    if (
      !confirm(
        `Delete project "${projectName}"? This permanently removes its tokens, policy assignments, findings, and related records.`,
      )
    ) {
      return false;
    }

    setDeletingId(projectId);
    try {
      await deleteProject(projectId);
      return true;
    } catch (err) {
      onError(getUserErrorMessage(err, "Failed to delete project"));
      return false;
    } finally {
      setDeletingId(null);
    }
  }

  return {
    creating,
    deletingId,
    handleCreate,
    handleDelete,
  };
}
