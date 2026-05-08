import { z } from "zod";
import type { McpRequestContext } from "../context.js";
import {
  McpToolExecutionError,
  type McpToolDefinition,
} from "../tool-registry.js";
import { listProjectViolationsForMcp } from "../services/list-project-violations-service.js";
import {
  projectReferenceInputSchemaJson,
  resolveProjectReference,
} from "./project-reference.js";

const inputSchema = z
  .object({
    project_id: z.string().uuid().optional(),
    project_name: z.string().trim().min(1).optional(),
    status: z.string().optional(),
    severity: z.string().optional(),
    package_version_id: z.string().uuid().optional(),
    search: z.string().optional(),
    rule_id: z.string().uuid().optional(),
    policy_id: z.string().uuid().optional(),
    include_details: z.boolean().optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .refine((value) => Boolean(value.project_id || value.project_name), {
    message: "project_name or project_id is required",
  });

export const listProjectViolationsToolDefinition: McpToolDefinition = {
  name: "list_project_violations",
  title: "List Project Violations",
  description: "List project violations with optional filters and enrichment.",
  inputSchema: {
    type: "object",
    properties: {
      ...projectReferenceInputSchemaJson,
      status: { type: "string" },
      severity: { type: "string" },
      package_version_id: { type: "string", format: "uuid" },
      search: { type: "string" },
      rule_id: { type: "string", format: "uuid" },
      policy_id: { type: "string", format: "uuid" },
      include_details: { type: "boolean" },
      since: { type: "string", format: "date-time" },
      until: { type: "string", format: "date-time" },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      offset: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
  },
};

export async function handleListProjectViolationsTool(
  ctx: McpRequestContext,
  params: unknown,
) {
  const parsed = inputSchema.safeParse(params);
  if (!parsed.success) {
    throw new McpToolExecutionError("project_name or project_id is required");
  }

  const project = await resolveProjectReference(ctx, parsed.data);
  return listProjectViolationsForMcp(ctx, project.id, {
    ...parsed.data,
    since: parsed.data.since ? new Date(parsed.data.since) : undefined,
    until: parsed.data.until ? new Date(parsed.data.until) : undefined,
  });
}
