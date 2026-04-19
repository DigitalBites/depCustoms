import { getProjectDisplayName } from "@/lib/project-metadata";
import { useTenantProjects } from "@/hooks/useTenantProjects";

export function useProjectName(projectId: string): string {
  const { projects } = useTenantProjects({ suppressErrors: true });
  return getProjectDisplayName(projects, projectId);
}
