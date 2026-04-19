import { listProjectPackages } from "../../packages/shared.js";
import type { McpRequestContext } from "../context.js";
import { requireMcpProjectAccess } from "./project-access.js";

export async function listProjectPackagesForMcp(
  ctx: McpRequestContext,
  projectId: string,
) {
  await requireMcpProjectAccess(ctx.principal, projectId);

  const rows = await listProjectPackages(projectId, ctx.principal.tenantId);
  return {
    tenant_id: ctx.principal.tenantId,
    project_id: projectId,
    packages: rows,
  };
}
