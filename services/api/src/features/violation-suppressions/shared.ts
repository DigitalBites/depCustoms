import { z } from "zod";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "../../db/index.js";
import { projects, violation_suppressions } from "../../db/schema.js";

export const createSuppressionSchema = z.object({
  project_id: z.string().uuid().nullable().optional(),
  package_id: z.string().uuid().nullable().optional(),
  package_version_id: z.string().uuid().nullable().optional(),
  rule_id: z.string().uuid().nullable().optional(),
  reason: z.string().nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
}).refine((value) => Boolean(value.package_id || value.package_version_id), {
  message: "package_id or package_version_id is required",
});

export async function loadSuppressionForTenant(id: string, tenantId: string) {
  const [suppression] = await db
    .select({ id: violation_suppressions.id })
    .from(violation_suppressions)
    .where(
      and(
        eq(violation_suppressions.id, id),
        eq(violation_suppressions.tenant_id, tenantId),
      ),
    )
    .limit(1);

  return suppression ?? null;
}

export async function projectExistsForTenant(
  projectId: string,
  tenantId: string,
) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenant_id, tenantId)))
    .limit(1);

  return project ?? null;
}

export async function listProjectViolationSuppressions(
  projectId: string,
  tenantId: string,
) {
  return db
    .select()
    .from(violation_suppressions)
    .where(
      and(
        eq(violation_suppressions.tenant_id, tenantId),
        or(
          eq(violation_suppressions.project_id, projectId),
          isNull(violation_suppressions.project_id),
        ),
      ),
    )
    .orderBy(desc(violation_suppressions.suppressed_at));
}

export async function listTenantViolationSuppressions(tenantId: string) {
  return db
    .select()
    .from(violation_suppressions)
    .where(eq(violation_suppressions.tenant_id, tenantId))
    .orderBy(desc(violation_suppressions.suppressed_at));
}
