import { z } from "zod";
import type { McpRequestContext } from "../context.js";
import {
  McpToolExecutionError,
  type McpToolDefinition,
} from "../tool-registry.js";
import { previewDependencyChangeForMcp } from "../services/preview-dependency-change-service.js";
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
    from_version: z.string().min(1),
    to_version: z.string().min(1),
  })
  .refine((value) => Boolean(value.project_id || value.project_name), {
    message: "project_name or project_id is required",
  });

export const previewDependencyChangeToolDefinition: McpToolDefinition = {
  name: "preview_dependency_change",
  title: "Preview Dependency Change",
  description:
    "Preview how a package version change would evaluate under the current effective policy using stored connector snapshots and observed package metadata.",
  inputSchema: {
    type: "object",
    properties: {
      ...projectReferenceInputSchemaJson,
      ecosystem: { type: "string" },
      package: { type: "string" },
      from_version: { type: "string" },
      to_version: { type: "string" },
    },
    required: ["ecosystem", "package", "from_version", "to_version"],
    additionalProperties: false,
  },
};

export async function handlePreviewDependencyChangeTool(
  ctx: McpRequestContext,
  params: unknown,
) {
  const parsed = inputSchema.safeParse(params);
  if (!parsed.success) {
    throw new McpToolExecutionError(
      "project_name or project_id, ecosystem, package, from_version, and to_version are required",
    );
  }

  const project = await resolveProjectReference(ctx, parsed.data);
  return previewDependencyChangeForMcp(ctx, {
    projectId: project.id,
    ecosystem: parsed.data.ecosystem,
    packageName: parsed.data.package,
    fromVersion: parsed.data.from_version,
    toVersion: parsed.data.to_version,
  });
}
