import type { McpRequestContext } from "../context.js";
import {
  McpToolExecutionError,
  type McpToolDefinition,
} from "../tool-registry.js";
import { listProjectPackagesForMcp } from "../services/list-project-packages-service.js";
import {
  projectReferenceInputSchema,
  projectReferenceInputSchemaJson,
  resolveProjectReference,
} from "./project-reference.js";

const inputSchema = projectReferenceInputSchema;

export const listProjectPackagesToolDefinition: McpToolDefinition = {
  name: "list_project_packages",
  title: "List Project Packages",
  description: "List observed packages and usage counts for a project.",
  inputSchema: {
    type: "object",
    properties: {
      ...projectReferenceInputSchemaJson,
    },
    additionalProperties: false,
  },
};

export async function handleListProjectPackagesTool(
  ctx: McpRequestContext,
  params: unknown,
) {
  const parsed = inputSchema.safeParse(params);
  if (!parsed.success) {
    throw new McpToolExecutionError("project_name or project_id is required");
  }

  const project = await resolveProjectReference(ctx, parsed.data);
  return listProjectPackagesForMcp(ctx, project.id);
}
