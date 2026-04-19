import { z } from "zod";
import type { Condition } from "../../policy/expression.js";

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

export const validatePolicyConditionSchema = z.object({
  condition: conditionSchema,
});

export const projectPolicyPreviewSchema = z.object({
  ecosystem: z.string().min(1),
  package: z.string().min(1),
  version: z.string().min(1),
  field_overrides: z.record(z.unknown()).optional(),
});

export const rulePreviewSchema = z.object({
  condition: conditionSchema,
  target_entity: z.string().min(1).optional(),
  ecosystem: z.string().min(1),
  package: z.string().min(1),
  version: z.string().min(1),
});

export function extractConnectorKeys(cond: Condition, keys: Set<string>): void {
  if ("all" in cond) {
    cond.all.forEach((child) => extractConnectorKeys(child, keys));
    return;
  }
  if ("any" in cond) {
    cond.any.forEach((child) => extractConnectorKeys(child, keys));
    return;
  }
  if ("not" in cond) {
    extractConnectorKeys(cond.not, keys);
    return;
  }
  if ("field" in cond && typeof cond.field === "string") {
    const match = cond.field.match(/^source\.([^.]+)\./);
    if (match) keys.add(match[1]);
  }
}
