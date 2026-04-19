import { z } from "zod";
import type { McpRequestContext } from "../context.js";
import {
  McpToolExecutionError,
  type McpToolDefinition,
} from "../tool-registry.js";
import { listProjectFindingsForMcp } from "../services/list-project-findings-service.js";
import {
  projectReferenceInputSchemaJson,
  resolveProjectReference,
} from "./project-reference.js";

const inputSchema = z
  .object({
    project_id: z.string().uuid().optional(),
    project_name: z.string().trim().min(1).optional(),
    connector_key: z.string().optional(),
    status: z.string().optional(),
    severity: z.string().optional(),
    include_details: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .refine((value) => Boolean(value.project_id || value.project_name), {
    message: "project_name or project_id is required",
  });

export const listProjectFindingsToolDefinition: McpToolDefinition = {
  name: "list_project_findings",
  title: "List Project Findings",
  description:
    "List project findings with optional filters and open violation counts.",
  inputSchema: {
    type: "object",
    properties: {
      ...projectReferenceInputSchemaJson,
      connector_key: { type: "string" },
      status: { type: "string" },
      severity: { type: "string" },
      include_details: { type: "boolean" },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      offset: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
  },
};

export async function handleListProjectFindingsTool(
  ctx: McpRequestContext,
  params: unknown,
) {
  const parsed = inputSchema.safeParse(params);
  if (!parsed.success) {
    throw new McpToolExecutionError("project_name or project_id is required");
  }

  const project = await resolveProjectReference(ctx, parsed.data);
  return listProjectFindingsForMcp(ctx, project.id, parsed.data);
}
