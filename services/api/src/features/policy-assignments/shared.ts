import { z } from "zod";
import {
  ENFORCEMENT_MODE_OVERRIDES,
  POLICY_BINDING_INHERITANCE_MODES,
} from "@customs/shared-constants";

export const bindingMutationSchema = z.object({
  enabled: z.boolean().optional(),
  inheritance_mode: z.enum(POLICY_BINDING_INHERITANCE_MODES).optional(),
  severity_override: z.string().nullable().optional(),
  threshold_overrides: z.record(z.unknown()).nullable().optional(),
  rule_overrides: z.record(z.unknown()).nullable().optional(),
  enforcement_mode_override: z
    .enum(ENFORCEMENT_MODE_OVERRIDES)
    .nullable()
    .optional(),
});

export const createBindingSchema = bindingMutationSchema.extend({
  project_id: z.string().uuid(),
});
