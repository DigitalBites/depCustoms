import { z } from "zod";
import {
  CAPABILITY,
  VIOLATION_STATUSES,
  WRITABLE_VIOLATION_STATUSES,
} from "@customs/shared-constants";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { rules, violation_suppressions, violations } from "../../db/schema.js";
import type { Context } from "hono";
import {
  requireResolvedProjectAccess,
  requireTenantCapability,
} from "../../http/guards.js";
import type { HttpResult } from "../../http/responses.js";
import type { projects } from "../../db/schema.js";
import {
  listViolations,
  loadViolationSummary,
  type ViolationListFilters,
} from "./query-service.js";

export const violationStatusUpdateSchema = z.object({
  status: z.enum(VIOLATION_STATUSES),
  status_note: z.string().nullable().optional(),
});

export const bulkViolationStatusUpdateSchema = z.object({
  violation_ids: z.array(z.string().uuid()).min(1).max(200),
  status: z.enum(WRITABLE_VIOLATION_STATUSES),
  status_note: z.string().nullable().optional(),
});

export async function requireViolationProjectAccess(
  c: Context,
  projectId: string,
): Promise<
  HttpResult<{
    projectId: string;
    project: typeof projects.$inferSelect;
  }>
> {
  const capabilityResult = requireTenantCapability(
    c,
    CAPABILITY.VIOLATIONS_READ_PROJECT,
    "Access denied",
  );
  if (!capabilityResult.ok) {
    return capabilityResult;
  }

  return requireResolvedProjectAccess(c, projectId);
}

export async function loadProjectViolationSummary(
  projectId: string,
  tenantId: string,
) {
  return loadViolationSummary({ tenantId, projectId });
}

export async function listProjectViolations(
  projectId: string,
  tenantId: string,
  filters: ViolationListFilters,
) {
  return listViolations({ tenantId, projectId }, filters);
}

export async function applyViolationStatusUpdate(
  violationId: string,
  tenantId: string,
  userId: string | null,
  body: {
    status: "open" | "resolved" | "suppressed";
    status_note?: string | null;
  },
) {
  const [existing] = await db
    .select({
      violation: violations,
      rule_key: rules.rule_key,
    })
    .from(violations)
    .leftJoin(rules, eq(violations.rule_id, rules.id))
    .where(
      and(eq(violations.id, violationId), eq(violations.tenant_id, tenantId)),
    )
    .limit(1);

  if (!existing) {
    return null;
  }

  const [updated] = await db
    .update(violations)
    .set({
      status: body.status,
      status_note: body.status_note ?? null,
      status_updated_by_user_id: userId,
      status_updated_at: new Date(),
    })
    .where(eq(violations.id, violationId))
    .returning();

  if (body.status === "suppressed") {
    const existingViolation = existing.violation ?? existing;
    await db
      .insert(violation_suppressions)
      .values({
        tenant_id: tenantId,
        project_id: existingViolation.project_id,
        package_id: existingViolation.package_id,
        package_version_id: existingViolation.package_version_id,
        rule_key: existing.rule_key,
        created_by_user_id: userId ?? null,
        suppressed_by_user_id: userId ?? null,
        reason: body.status_note ?? null,
      })
      .onConflictDoNothing();
  }

  return updated;
}

export async function applyBulkViolationStatusUpdate(
  violationIds: string[],
  tenantId: string,
  userId: string | null,
  body: { status: "resolved" | "suppressed"; status_note?: string | null },
) {
  const uniqueViolationIds = [...new Set(violationIds)];
  if (uniqueViolationIds.length === 0) {
    return { updatedIds: [] as string[] };
  }

  const existing = await db
    .select({
      id: violations.id,
      project_id: violations.project_id,
      package_id: violations.package_id,
      package_version_id: violations.package_version_id,
      rule_key: rules.rule_key,
    })
    .from(violations)
    .leftJoin(rules, eq(violations.rule_id, rules.id))
    .where(
      and(
        eq(violations.tenant_id, tenantId),
        inArray(violations.id, uniqueViolationIds),
      ),
    );

  if (existing.length === 0) {
    return { updatedIds: [] as string[] };
  }

  const updatedRows = await db
    .update(violations)
    .set({
      status: body.status,
      status_note: body.status_note ?? null,
      status_updated_by_user_id: userId,
      status_updated_at: new Date(),
    })
    .where(
      and(
        eq(violations.tenant_id, tenantId),
        inArray(
          violations.id,
          existing.map((row) => row.id),
        ),
      ),
    )
    .returning({ id: violations.id });

  if (body.status === "suppressed") {
    await db
      .insert(violation_suppressions)
      .values(
        existing.map((row) => ({
          tenant_id: tenantId,
          project_id: row.project_id,
          package_id: row.package_id,
          package_version_id: row.package_version_id,
          rule_key: row.rule_key,
          created_by_user_id: userId ?? null,
          suppressed_by_user_id: userId ?? null,
          reason: body.status_note ?? null,
        })),
      )
      .onConflictDoNothing();
  }

  return { updatedIds: updatedRows.map((row) => row.id) };
}
