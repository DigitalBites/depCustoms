import { z } from "zod";
import type { McpRequestContext } from "../context.js";
import {
  McpToolExecutionError,
  type McpToolDefinition,
} from "../tool-registry.js";
import { listVulnerablePackagesForMcp } from "../services/list-vulnerable-packages-service.js";
import {
  projectReferenceInputSchemaJson,
  resolveProjectReference,
} from "./project-reference.js";

const inputSchema = z
  .object({
    project_id: z.string().uuid().optional(),
    project_name: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .refine((value) => Boolean(value.project_id || value.project_name), {
    message: "project_name or project_id is required",
  });

export const listVulnerablePackagesToolDefinition: McpToolDefinition = {
  name: "list_vulnerable_packages",
  title: "List Vulnerable Packages",
  description:
    "List vulnerable packages observed in a project with severity, fix availability, and latest-version context.",
  inputSchema: {
    type: "object",
    properties: {
      ...projectReferenceInputSchemaJson,
      limit: { type: "integer", minimum: 1, maximum: 200 },
      offset: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
  },
};

export async function handleListVulnerablePackagesTool(
  ctx: McpRequestContext,
  params: unknown,
) {
  const parsed = inputSchema.safeParse(params);
  if (!parsed.success) {
    throw new McpToolExecutionError("project_name or project_id is required");
  }

  const project = await resolveProjectReference(ctx, parsed.data);
  return listVulnerablePackagesForMcp(ctx, project.id, parsed.data);
}
