export interface ProjectSummary {
  id: string;
  name: string;
  tenant_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface TenantProjectsResponse {
  projects: ProjectSummary[];
}

export interface CreateProjectRequest {
  name: string;
}
