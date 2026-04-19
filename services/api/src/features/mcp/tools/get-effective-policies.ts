import type { McpToolDefinition } from "../tool-registry.js";
import { McpToolExecutionError } from "../tool-registry.js";
import type { McpRequestContext } from "../context.js";
import { getEffectivePoliciesForMcp } from "../services/get-effective-policies-service.js";
import {
  projectReferenceInputSchema,
  projectReferenceInputSchemaJson,
  resolveProjectReference,
} from "./project-reference.js";

const inputSchema = projectReferenceInputSchema;

export const getEffectivePoliciesToolDefinition: McpToolDefinition = {
  name: "get_effective_policies",
  title: "Get Effective Policies",
  description:
    "Return the effective policy set for a project, including inherited and project-scoped rules.",
  inputSchema: {
    type: "object",
    properties: {
      ...projectReferenceInputSchemaJson,
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      tenant_id: { type: "string" },
      project_id: { type: "string" },
      resolved_at: { type: "string" },
      policies: { type: "array" },
    },
    required: ["tenant_id", "project_id", "resolved_at", "policies"],
  },
};

export async function handleGetEffectivePoliciesTool(
  ctx: McpRequestContext,
  params: unknown,
) {
  const parsed = inputSchema.safeParse(params);
  if (!parsed.success) {
    throw new McpToolExecutionError("project_name or project_id is required");
  }

  const project = await resolveProjectReference(ctx, parsed.data);
  return getEffectivePoliciesForMcp(ctx, project.id);
}
