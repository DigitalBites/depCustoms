import { and, eq } from "drizzle-orm";
import { db } from "../../../db/index.js";
import { project_members, projects } from "../../../db/schema.js";
import {
  canPerform,
  checkProjectAccess,
  hasImplicitProjectAccess,
} from "../../../middleware/rbac.js";
import type { McpPrincipal } from "../context.js";
import { McpToolExecutionError } from "../tool-registry.js";

type ResolveMcpProjectParams = {
  projectId?: string | null;
  projectName?: string | null;
};

export async function listAccessibleMcpProjects(
  principal: McpPrincipal,
): Promise<Array<{ id: string; name: string }>> {
  return listAccessibleScopedMcpProjects(principal);
}

async function listAccessibleScopedMcpProjects(
  principal: McpPrincipal,
): Promise<Array<{ id: string; name: string }>> {
  if (!canPerform(principal.role, "mcp.use_project")) {
    return [];
  }

  if (hasImplicitProjectAccess(principal.role)) {
    return db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.tenant_id, principal.tenantId))
      .orderBy(projects.name);
  }

  return db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .innerJoin(
      project_members,
      and(
        eq(project_members.project_id, projects.id),
        eq(project_members.user_id, principal.userId),
        eq(project_members.tenant_id, principal.tenantId),
      ),
    )
    .where(eq(projects.tenant_id, principal.tenantId))
    .orderBy(projects.name);
}

export async function resolveMcpProject(
  principal: McpPrincipal,
  params: ResolveMcpProjectParams,
): Promise<{ id: string; name: string }> {
  const projectId = params.projectId?.trim() || null;
  const projectName = params.projectName?.trim() || null;

  if (!projectId && !projectName) {
    const accessibleProjects = await listAccessibleScopedMcpProjects(principal);
    if (accessibleProjects.length === 0) {
      throw new McpToolExecutionError(
        "No accessible projects are available for MCP project tools",
      );
    }

    if (accessibleProjects.length === 1) {
      const [project] = accessibleProjects;
      if (!project) {
        throw new McpToolExecutionError("Project not found");
      }
      return project;
    }

    throw new McpToolExecutionError(
      `project_name or project_id is required. Available projects: ${accessibleProjects
        .map((project) => project.name)
        .join(", ")}`,
    );
  }

  const rows = projectId
    ? await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(
          and(
            eq(projects.id, projectId),
            eq(projects.tenant_id, principal.tenantId),
          ),
        )
        .limit(1)
    : await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(
          and(
            eq(projects.name, projectName as string),
            eq(projects.tenant_id, principal.tenantId),
          ),
        )
        .limit(2);

  if (rows.length === 0) {
    throw new McpToolExecutionError("Project not found");
  }

  if (!projectId && rows.length > 1) {
    throw new McpToolExecutionError(
      "Project name is ambiguous in this tenant; use project_id instead",
    );
  }

  const project = rows[0];
  if (!project) {
    throw new McpToolExecutionError("Project not found");
  }

  if (!canPerform(principal.role, "mcp.use_project")) {
    throw new McpToolExecutionError("Access denied to MCP project tools");
  }

  if (!hasImplicitProjectAccess(principal.role)) {
    const hasAccess = await checkProjectAccess(
      principal.userId,
      project.id,
      principal.tenantId,
      principal.role,
    );
    if (!hasAccess) {
      throw new McpToolExecutionError("Access denied to this project");
    }
  }

  return project;
}

export async function requireMcpProjectAccess(
  principal: McpPrincipal,
  projectId: string,
): Promise<void> {
  await resolveMcpProject(principal, { projectId });
}
