import { z } from "zod";
import { SCORE_TIERS } from "@customs/shared-constants";
import type { McpRequestContext } from "../context.js";
import {
  McpToolExecutionError,
  type McpToolDefinition,
} from "../tool-registry.js";
import { listProjectContributorPackagesForMcp } from "../services/list-project-contributor-packages-service.js";
import {
  projectReferenceInputSchemaJson,
  resolveProjectReference,
} from "./project-reference.js";

const inputSchema = z
  .object({
    project_id: z.string().uuid().optional(),
    project_name: z.string().trim().min(1).optional(),
    score_tier: z.enum(SCORE_TIERS).optional(),
    min_score: z.number().int().min(0).max(100).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .refine((value) => Boolean(value.project_id || value.project_name), {
    message: "project_name or project_id is required",
  });

export const listProjectContributorPackagesToolDefinition: McpToolDefinition = {
  name: "list_project_contributor_packages",
  title: "List Project Contributor Packages",
  description:
    "List observed package versions in a project with contributor-risk context, actor continuity, and raw score factors.",
  inputSchema: {
    type: "object",
    properties: {
      ...projectReferenceInputSchemaJson,
      score_tier: {
        type: "string",
        enum: [...SCORE_TIERS],
      },
      min_score: { type: "integer", minimum: 0, maximum: 100 },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      offset: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
  },
};

export async function handleListProjectContributorPackagesTool(
  ctx: McpRequestContext,
  params: unknown,
) {
  const parsed = inputSchema.safeParse(params);
  if (!parsed.success) {
    throw new McpToolExecutionError("project_name or project_id is required");
  }

  const project = await resolveProjectReference(ctx, parsed.data);
  return listProjectContributorPackagesForMcp(ctx, project.id, parsed.data);
}
