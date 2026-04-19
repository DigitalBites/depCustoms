import { z } from "zod";
import type { McpRequestContext } from "../context.js";
import {
  McpToolExecutionError,
  type McpToolDefinition,
} from "../tool-registry.js";
import { getProjectDependencyContextForMcp } from "../services/get-project-dependency-context-service.js";
import {
  projectReferenceInputSchemaJson,
  resolveProjectReference,
} from "./project-reference.js";

const inputSchema = z
  .object({
    project_id: z.string().uuid().optional(),
    project_name: z.string().trim().min(1).optional(),
    ecosystem: z.string().min(1),
    package: z.string().min(1),
  })
  .refine((value) => Boolean(value.project_id || value.project_name), {
    message: "project_name or project_id is required",
  });

export const getProjectDependencyContextToolDefinition: McpToolDefinition = {
  name: "get_project_dependency_context",
  title: "Get Project Dependency Context",
  description:
    "Summarize everything the project currently knows about one package across observed versions, including latest known version, fix metadata, and per-version policy outcomes.",
  inputSchema: {
    type: "object",
    properties: {
      ...projectReferenceInputSchemaJson,
      ecosystem: { type: "string" },
      package: { type: "string" },
    },
    required: ["ecosystem", "package"],
    additionalProperties: false,
  },
};

export async function handleGetProjectDependencyContextTool(
  ctx: McpRequestContext,
  params: unknown,
) {
  const parsed = inputSchema.safeParse(params);
  if (!parsed.success) {
    throw new McpToolExecutionError(
      "project_name or project_id, ecosystem, and package are required",
    );
  }

  const project = await resolveProjectReference(ctx, parsed.data);
  return getProjectDependencyContextForMcp(ctx, {
    projectId: project.id,
    ecosystem: parsed.data.ecosystem,
    packageName: parsed.data.package,
  });
}
