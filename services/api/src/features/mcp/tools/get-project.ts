import type { McpToolDefinition } from "../tool-registry.js";
import { McpToolExecutionError } from "../tool-registry.js";
import type { McpRequestContext } from "../context.js";
import { getProjectForMcp } from "../services/get-project-service.js";
import {
  projectReferenceInputSchema,
  projectReferenceInputSchemaJson,
} from "./project-reference.js";

const inputSchema = projectReferenceInputSchema;

export const getProjectToolDefinition: McpToolDefinition = {
  name: "get_project",
  title: "Get Project",
  description:
    "Resolve one accessible project in the active tenant by name or id and return its canonical reference.",
  inputSchema: {
    type: "object",
    properties: {
      ...projectReferenceInputSchemaJson,
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      tenant_id: { type: "string" },
      tenant_name: { type: ["string", "null"] },
      project_id: { type: "string" },
      project_name: { type: "string" },
    },
    required: ["tenant_id", "project_id", "project_name"],
  },
};

export async function handleGetProjectTool(
  ctx: McpRequestContext,
  params: unknown,
) {
  const parsed = inputSchema.safeParse(params);
  if (!parsed.success) {
    throw new McpToolExecutionError("project_name or project_id is required");
  }

  return getProjectForMcp(ctx, {
    projectId: parsed.data.project_id ?? null,
    projectName: parsed.data.project_name ?? null,
  });
}
