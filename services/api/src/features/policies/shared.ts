import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  CREATABLE_POLICY_STATUSES,
  ENFORCEMENT_MODES,
  POLICY_SCOPES,
  POLICY_STATUSES,
} from "@customs/shared-constants";
import { db } from "../../db/index.js";
import { policies } from "../../db/schema.js";
import {
  isoDatetimeQuerySchema,
  optionalStringQuerySchema,
  paginationQuerySchema,
} from "../../http/validation.js";

export const listPoliciesQuerySchema = z.object({
  scope: optionalStringQuerySchema,
  status: optionalStringQuerySchema,
});

export const createPolicySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  category: z.string().optional(),
  scope: z.enum(POLICY_SCOPES),
  enforcement_mode: z.enum(ENFORCEMENT_MODES).optional(),
  priority: z.number().int().min(1).optional(),
  status: z.enum(CREATABLE_POLICY_STATUSES).optional(),
});

export const patchPolicySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  enforcement_mode: z.enum(ENFORCEMENT_MODES).optional(),
  priority: z.number().int().min(1).optional(),
  status: z.enum(POLICY_STATUSES).optional(),
});

export const createProjectPolicySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  enforcement_mode: z.enum(ENFORCEMENT_MODES).optional(),
  priority: z.number().int().min(1).optional(),
});

export const policyViolationsQuerySchema = paginationQuerySchema(
  50,
  200,
).extend({
  rule_id: optionalStringQuerySchema,
  status: optionalStringQuerySchema,
  since: isoDatetimeQuerySchema.optional(),
  search: optionalStringQuerySchema,
});

export async function loadPolicyForTenant(policyId: string, tenantId: string) {
  const [policy] = await db
    .select()
    .from(policies)
    .where(and(eq(policies.id, policyId), eq(policies.tenant_id, tenantId)))
    .limit(1);

  return policy ?? null;
}
