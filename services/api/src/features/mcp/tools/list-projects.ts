import { z } from "zod";
import type { McpRequestContext } from "../context.js";
import {
  McpToolExecutionError,
  type McpToolDefinition,
} from "../tool-registry.js";
import { listProjectsForMcp } from "../services/list-projects-service.js";

const inputSchema = z.object({
  search: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const listProjectsToolDefinition: McpToolDefinition = {
  name: "list_projects",
  title: "List Projects",
  description:
    "List projects accessible in the active tenant so project-scoped MCP tools can use exact project ids or names.",
  inputSchema: {
    type: "object",
    properties: {
      search: {
        type: "string",
        description:
          "Optional case-insensitive substring filter for project names.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 200,
        description: "Maximum number of projects to return. Defaults to all.",
      },
    },
    additionalProperties: false,
  },
};

export async function handleListProjectsTool(
  ctx: McpRequestContext,
  params: unknown,
) {
  const parsed = inputSchema.safeParse(params ?? {});
  if (!parsed.success) {
    throw new McpToolExecutionError("Invalid list_projects arguments");
  }

  return listProjectsForMcp(ctx, parsed.data);
}
