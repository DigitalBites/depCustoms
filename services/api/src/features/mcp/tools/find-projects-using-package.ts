import { z } from "zod";
import type { McpRequestContext } from "../context.js";
import {
  McpToolExecutionError,
  type McpToolDefinition,
} from "../tool-registry.js";
import { findProjectsUsingPackageForMcp } from "../services/find-projects-using-package-service.js";

const inputSchema = z.object({
  ecosystem: z.string().min(1),
  package: z.string().min(1),
  version: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

export const findProjectsUsingPackageToolDefinition: McpToolDefinition = {
  name: "find_projects_using_package",
  title: "Find Projects Using Package",
  description:
    "Find tenant projects currently using a package, optionally narrowed to one version. Requires tenant-wide MCP package usage access.",
  inputSchema: {
    type: "object",
    properties: {
      ecosystem: { type: "string" },
      package: { type: "string" },
      version: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      offset: { type: "integer", minimum: 0 },
    },
    required: ["ecosystem", "package"],
    additionalProperties: false,
  },
};

export async function handleFindProjectsUsingPackageTool(
  ctx: McpRequestContext,
  params: unknown,
) {
  const parsed = inputSchema.safeParse(params);
  if (!parsed.success) {
    throw new McpToolExecutionError("ecosystem and package are required");
  }

  return findProjectsUsingPackageForMcp(ctx, {
    ecosystem: parsed.data.ecosystem,
    packageName: parsed.data.package,
    version: parsed.data.version,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  });
}
