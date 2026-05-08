import {
  paginationQuerySchema,
  isoDatetimeQuerySchema,
  optionalStringQuerySchema,
} from "../../http/validation.js";

export const projectEvaluationsQuerySchema = paginationQuerySchema(
  50,
  200,
).extend({
  decision: optionalStringQuerySchema,
  package_version_id: optionalStringQuerySchema,
  since: isoDatetimeQuerySchema.optional(),
});

export const entityEvaluationsQuerySchema = paginationQuerySchema(10, 50);
