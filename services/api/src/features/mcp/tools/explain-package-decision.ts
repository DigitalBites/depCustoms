import { z } from "zod";
import type { McpToolDefinition } from "../tool-registry.js";
import { McpToolExecutionError } from "../tool-registry.js";
import type { McpRequestContext } from "../context.js";
import { explainPackageDecisionForMcp } from "../services/explain-package-decision-service.js";
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
    version: z.string().min(1),
  })
  .refine((value) => Boolean(value.project_id || value.project_name), {
    message: "project_name or project_id is required",
  });

export const explainPackageDecisionToolDefinition: McpToolDefinition = {
  name: "explain_package_decision",
  title: "Explain Package Decision",
  description:
    "Explain whether a package version is effectively allowed or blocked for a project and summarize the current policy and finding context.",
  inputSchema: {
    type: "object",
    properties: {
      ...projectReferenceInputSchemaJson,
      ecosystem: { type: "string" },
      package: { type: "string" },
      version: { type: "string" },
    },
    required: ["ecosystem", "package", "version"],
    additionalProperties: false,
  },
};

export async function handleExplainPackageDecisionTool(
  ctx: McpRequestContext,
  params: unknown,
) {
  const parsed = inputSchema.safeParse(params);
  if (!parsed.success) {
    throw new McpToolExecutionError(
      "project_name or project_id, ecosystem, package, and version are required",
    );
  }

  const project = await resolveProjectReference(ctx, parsed.data);
  return explainPackageDecisionForMcp(ctx, {
    projectId: project.id,
    ecosystem: parsed.data.ecosystem,
    packageName: parsed.data.package,
    version: parsed.data.version,
  });
}
