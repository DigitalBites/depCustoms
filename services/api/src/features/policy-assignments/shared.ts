import { z } from "zod";

export const assignmentMutationSchema = z.object({
  enabled: z.boolean().optional(),
  inheritance_mode: z.enum(["inherited", "override", "disabled"]).optional(),
  severity_override: z.string().nullable().optional(),
  threshold_overrides: z.record(z.unknown()).nullable().optional(),
  enforcement_mode_override: z
    .enum(["advisory", "disabled"])
    .nullable()
    .optional(),
});

export const createAssignmentSchema = assignmentMutationSchema.extend({
  project_id: z.string().uuid(),
});
