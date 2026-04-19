import { z } from "zod";

export const uuidStringSchema = z.string().uuid();

export function paginationQuerySchema(defaultLimit: number, maxLimit: number) {
  return z.object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(maxLimit)
      .optional()
      .default(defaultLimit),
    offset: z.coerce.number().int().min(0).optional().default(0),
  });
}

export const isoDatetimeQuerySchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

export const tenantIdParamSchema = uuidStringSchema;
export const projectIdParamSchema = uuidStringSchema;
export const connectorKeyParamSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);
export const syncScopeQuerySchema = z
  .enum(["all", "vulnerable"])
  .optional()
  .default("all");
export const optionalStringQuerySchema = z.string().min(1).optional();
export const optionalBooleanQuerySchema = z
  .enum(["true", "false"])
  .optional()
  .default("false")
  .transform((value) => value === "true");
