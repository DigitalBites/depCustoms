import { z } from "zod";

export const conditionSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema) }),
    z.object({ any: z.array(conditionSchema) }),
    z.object({ not: conditionSchema }),
    z.object({
      field: z.string().min(1),
      operator: z.string().min(1),
      value: z.unknown().optional(),
    }),
  ]),
);

export const actionSchema = z.object({
  type: z.enum(["violation", "warning", "info"]),
  severity: z.enum(["critical", "high", "medium", "low"]).optional(),
  code: z.string().min(1).optional(),
  message_template: z.string().optional(),
  recommended_remediation: z.string().optional(),
  enforcement_mode: z.enum(["enforcing", "advisory"]).optional(),
});

export const createRuleSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  target_entity: z.enum(["artifact", "dependency", "finding", "repository"]),
  condition: conditionSchema,
  action: actionSchema,
  enabled: z.boolean().optional(),
  order_index: z.number().int().min(0).optional(),
});

export const patchRuleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  target_entity: z
    .enum(["artifact", "dependency", "finding", "repository"])
    .optional(),
  condition: conditionSchema.optional(),
  action: actionSchema.optional(),
  enabled: z.boolean().optional(),
  order_index: z.number().int().min(0).optional(),
});

export const reorderRulesSchema = z.object({
  order: z
    .array(
      z.object({
        id: z.string().uuid(),
        order_index: z.number().int().min(0),
      }),
    )
    .min(1),
});
