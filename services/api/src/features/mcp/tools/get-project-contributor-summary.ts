import type { McpRequestContext } from "../context.js";
import {
  McpToolExecutionError,
  type McpToolDefinition,
} from "../tool-registry.js";
import { getProjectContributorSummaryForMcp } from "../services/get-project-contributor-summary-service.js";
import {
  projectReferenceInputSchema,
  projectReferenceInputSchemaJson,
  resolveProjectReference,
} from "./project-reference.js";

const inputSchema = projectReferenceInputSchema;

export const getProjectContributorSummaryToolDefinition: McpToolDefinition = {
  name: "get_project_contributor_summary",
  title: "Get Project Contributor Summary",
  description:
    "Return contributor-risk coverage, risk-bucket counts, and contributor signal counts for a project.",
  inputSchema: {
    type: "object",
    properties: {
      ...projectReferenceInputSchemaJson,
    },
    additionalProperties: false,
  },
};

export async function handleGetProjectContributorSummaryTool(
  ctx: McpRequestContext,
  params: unknown,
) {
  const parsed = inputSchema.safeParse(params);
  if (!parsed.success) {
    throw new McpToolExecutionError("project_name or project_id is required");
  }

  const project = await resolveProjectReference(ctx, parsed.data);
  return getProjectContributorSummaryForMcp(ctx, project.id);
}
