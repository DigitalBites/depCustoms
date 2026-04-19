import { apiFetch } from "@/lib/api";
import type {
  CreateProjectRequest,
  ProjectSummary,
  TenantProjectsResponse,
} from "@/features/projects/types";

export async function fetchTenantProjects(
  tenantId: string,
): Promise<ProjectSummary[]> {
  const data = (await apiFetch(
    `/v1/tenants/${tenantId}/projects`,
  )) as TenantProjectsResponse;
  return data.projects;
}

export async function createProject(
  tenantId: string,
  name: string,
): Promise<void> {
  const body: CreateProjectRequest = { name };
  await apiFetch(`/v1/tenants/${tenantId}/projects`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  await apiFetch(`/v1/projects/${projectId}`, {
    method: "DELETE",
  });
}
