import { useCallback, useState } from "react";
import { useDashboard } from "@/components/dashboard-provider";
import {
  createProject,
  deleteProject,
  fetchTenantProjects,
} from "@/features/projects/api";
import type { ProjectSummary } from "@/features/projects/types";
import { getUserErrorMessage } from "@/lib/api-error";
import { useConfirm } from "@/components/confirm-dialog-provider";
import { useMutation } from "@/hooks/useMutation";
import { useResource } from "@/hooks/useResource";

export function useTenantProjects({
  enabled = true,
  suppressErrors = false,
}: {
  enabled?: boolean;
  suppressErrors?: boolean;
} = {}) {
  const { tenantId } = useDashboard();
  const loadProjects = useCallback(
    () => fetchTenantProjects(tenantId),
    [tenantId],
  );
  const {
    data: projects,
    loading,
    error,
    setError,
    reload,
  } = useResource<ProjectSummary[]>(loadProjects, {
    initialData: [],
    enabled,
    suppressErrors,
    errorPrefix: "Failed to load projects",
  });

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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const confirm = useConfirm();
  const { pending: creating, run: createProjectMutation } = useMutation(
    (name: string) => createProject(tenantId, name),
    "Failed to create project",
  );

  async function handleCreate(name: string) {
    const result = await createProjectMutation(name);
    if (!result.ok) {
      onError(result.error);
      return false;
    }
    return true;
  }

  async function handleDelete(projectId: string, projectName: string) {
    const confirmed = await confirm({
      title: `Delete project "${projectName}"?`,
      description:
        "This permanently removes its tokens, policy bindings, findings, and related records.",
      confirmLabel: "Delete project",
      variant: "destructive",
    });
    if (!confirmed) {
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
