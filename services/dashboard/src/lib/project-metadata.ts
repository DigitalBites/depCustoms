import type { ProjectSummary } from "@/hooks/useTenantProjects";

export interface NamedProject extends ProjectSummary {
  id: string;
  name: string;
}

export function getProjectDisplayName(
  projects: NamedProject[],
  projectId: string,
  fallback = "Project",
): string {
  return projects.find((project) => project.id === projectId)?.name ?? fallback;
}
