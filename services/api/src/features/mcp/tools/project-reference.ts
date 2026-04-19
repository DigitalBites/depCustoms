import { z } from "zod";
import type { McpRequestContext } from "../context.js";
import { resolveMcpProject } from "../services/project-access.js";
import { McpToolExecutionError } from "../tool-registry.js";

export const projectReferenceInputSchema = z
  .object({
    project_name: z.string().trim().min(1).optional(),
    project_id: z.string().uuid().optional(),
  })
  .refine((value) => Boolean(value.project_name || value.project_id), {
    message: "project_name or project_id is required",
  });

export const projectReferenceInputSchemaJson = {
  project_name: {
    type: "string",
    description:
      "Human-readable project name within the active tenant. Preferred over project_id.",
  },
  project_id: {
    type: "string",
    format: "uuid",
    description:
      "Project UUID. Use this when project_name is ambiguous or unknown.",
  },
} as const;

export async function resolveProjectReference(
  ctx: McpRequestContext,
  input: { project_id?: string; project_name?: string },
) {
  if (input.project_id && !input.project_name) {
    return {
      id: input.project_id,
      name: input.project_id,
    };
  }

  try {
    return await resolveMcpProject(ctx.principal, {
      projectId: input.project_id ?? null,
      projectName: input.project_name ?? null,
    });
  } catch (error) {
    if (error instanceof McpToolExecutionError) {
      throw error;
    }
    throw new McpToolExecutionError("Unable to resolve project");
  }
}
