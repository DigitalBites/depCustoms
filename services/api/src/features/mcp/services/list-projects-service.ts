import { listAccessibleProjectSummaries } from "../../projects/service.js";
import type { McpRequestContext } from "../context.js";
import { canPerform } from "../../../middleware/rbac.js";
import { McpToolExecutionError } from "../tool-registry.js";

type ListProjectsForMcpInput = {
  search?: string;
  limit?: number;
};

export async function listProjectsForMcp(
  ctx: McpRequestContext,
  input: ListProjectsForMcpInput,
) {
  if (!canPerform(ctx.principal.role, "mcp.use_project")) {
    throw new McpToolExecutionError("Access denied to MCP project tools");
  }

  const tenant = ctx.principal.tenants.find(
    (item) => item.tenant_id === ctx.principal.tenantId,
  );

  const projects = await listAccessibleProjectSummaries({
    tenantId: ctx.principal.tenantId,
    userId: ctx.principal.userId,
    role: ctx.principal.role,
    search: input.search,
    limit: input.limit,
  });

  return {
    tenant_id: ctx.principal.tenantId,
    tenant_name: tenant?.tenant_name ?? null,
    total: projects.length,
    projects: projects.map((project) => ({
      project_id: project.id,
      project_name: project.name,
    })),
  };
}
