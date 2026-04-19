import { z } from "zod";
import type { McpToolDefinition } from "../tool-registry.js";
import { McpToolExecutionError } from "../tool-registry.js";
import type { McpRequestContext } from "../context.js";
import { listRecentlyBlockedPackagesForMcp } from "../services/list-recently-blocked-packages-service.js";
import {
  projectReferenceInputSchemaJson,
  resolveProjectReference,
} from "./project-reference.js";

const inputSchema = z
  .object({
    project_id: z.string().uuid().optional(),
    project_name: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .refine((value) => Boolean(value.project_id || value.project_name), {
    message: "project_name or project_id is required",
  });

export const listRecentlyBlockedPackagesToolDefinition: McpToolDefinition = {
  name: "list_recently_blocked_packages",
  title: "List Recently Blocked Packages",
  description:
    "List recently blocked packages for a project with the latest known block reason and matching rule.",
  inputSchema: {
    type: "object",
    properties: {
      ...projectReferenceInputSchemaJson,
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
    additionalProperties: false,
  },
};

export async function handleListRecentlyBlockedPackagesTool(
  ctx: McpRequestContext,
  params: unknown,
) {
  const parsed = inputSchema.safeParse(params);
  if (!parsed.success) {
    throw new McpToolExecutionError("project_name or project_id is required");
  }

  const project = await resolveProjectReference(ctx, parsed.data);
  return listRecentlyBlockedPackagesForMcp(
    ctx,
    project.id,
    parsed.data.limit ?? 25,
  );
}
