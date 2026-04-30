import type { McpRequestContext } from "../context.js";
import { resolveMcpProject } from "./project-access.js";

type GetProjectForMcpInput = {
  projectId?: string | null;
  projectName?: string | null;
};

export async function getProjectForMcp(
  ctx: McpRequestContext,
  input: GetProjectForMcpInput,
) {
  const project = await resolveMcpProject(ctx.principal, {
    projectId: input.projectId ?? null,
    projectName: input.projectName ?? null,
  });

  const tenant = ctx.principal.tenants.find(
    (item) => item.tenant_id === ctx.principal.tenantId,
  );

  return {
    tenant_id: ctx.principal.tenantId,
    tenant_name: tenant?.tenant_name ?? null,
    project_id: project.id,
    project_name: project.name,
  };
}
