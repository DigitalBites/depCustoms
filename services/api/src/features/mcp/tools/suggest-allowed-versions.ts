import { z } from "zod";
import type { McpRequestContext } from "../context.js";
import {
  McpToolExecutionError,
  type McpToolDefinition,
} from "../tool-registry.js";
import { suggestAllowedVersionsForMcp } from "../services/suggest-allowed-versions-service.js";
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
    current_version: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.project_id || value.project_name), {
    message: "project_name or project_id is required",
  });

export const suggestAllowedVersionsToolDefinition: McpToolDefinition = {
  name: "suggest_allowed_versions",
  title: "Suggest Allowed Versions",
  description:
    "Suggest package versions that are more likely to satisfy the current project policy using observed versions, latest known version metadata, and known fix versions.",
  inputSchema: {
    type: "object",
    properties: {
      ...projectReferenceInputSchemaJson,
      ecosystem: { type: "string" },
      package: { type: "string" },
      current_version: { type: "string" },
    },
    required: ["ecosystem", "package"],
    additionalProperties: false,
  },
};

export async function handleSuggestAllowedVersionsTool(
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
  return suggestAllowedVersionsForMcp(ctx, {
    projectId: project.id,
    ecosystem: parsed.data.ecosystem,
    packageName: parsed.data.package,
    currentVersion: parsed.data.current_version,
  });
}
