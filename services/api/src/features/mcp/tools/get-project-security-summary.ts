import type { McpRequestContext } from "../context.js";
import {
  McpToolExecutionError,
  type McpToolDefinition,
} from "../tool-registry.js";
import { getProjectSecuritySummaryForMcp } from "../services/get-project-security-summary-service.js";
import {
  projectReferenceInputSchema,
  projectReferenceInputSchemaJson,
  resolveProjectReference,
} from "./project-reference.js";

const inputSchema = projectReferenceInputSchema;

export const getProjectSecuritySummaryToolDefinition: McpToolDefinition = {
  name: "get_project_security_summary",
  title: "Get Project Security Summary",
  description:
    "Return the security summary for a project, including findings and blocked-violation trends.",
  inputSchema: {
    type: "object",
    properties: {
      ...projectReferenceInputSchemaJson,
    },
    additionalProperties: false,
  },
};

export async function handleGetProjectSecuritySummaryTool(
  ctx: McpRequestContext,
  params: unknown,
) {
  const parsed = inputSchema.safeParse(params);
  if (!parsed.success) {
    throw new McpToolExecutionError("project_name or project_id is required");
  }

  const project = await resolveProjectReference(ctx, parsed.data);
  return getProjectSecuritySummaryForMcp(ctx, project.id);
}
