import {
  isoDatetimeQuerySchema,
  optionalStringQuerySchema,
  paginationQuerySchema,
} from "../../http/validation.js";

export const violationsListQuerySchema = paginationQuerySchema(50, 200).extend({
  status: optionalStringQuerySchema,
  severity: optionalStringQuerySchema,
  since: isoDatetimeQuerySchema.optional(),
  until: isoDatetimeQuerySchema.optional(),
  package_version_id: optionalStringQuerySchema,
  search: optionalStringQuerySchema,
  rule_id: optionalStringQuerySchema,
  policy_id: optionalStringQuerySchema,
});

export const tenantViolationsQuerySchema = paginationQuerySchema(
  50,
  200,
).extend({
  status: optionalStringQuerySchema,
  severity: optionalStringQuerySchema,
  since: isoDatetimeQuerySchema.optional(),
  package_version_id: optionalStringQuerySchema,
  search: optionalStringQuerySchema,
  rule_id: optionalStringQuerySchema,
  policy_id: optionalStringQuerySchema,
});
