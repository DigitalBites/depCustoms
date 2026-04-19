import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { violation_suppressions, violations } from "../../db/schema.js";
import type { Context } from "hono";
import {
  requireResolvedProjectAccess,
  requireTenantCapability,
} from "../../http/guards.js";
import {
  listViolations,
  loadViolationSummary,
  type ViolationListFilters,
} from "./query-service.js";

export const violationStatusUpdateSchema = z.object({
  status: z.enum(["open", "resolved", "suppressed"]),
  status_note: z.string().nullable().optional(),
});

export const bulkViolationStatusUpdateSchema = z.object({
  violation_ids: z.array(z.string().uuid()).min(1).max(200),
  status: z.enum(["resolved", "suppressed"]),
  status_note: z.string().nullable().optional(),
});

export async function requireViolationProjectAccess(
  c: Context,
  projectId: string,
) {
  if (!requireTenantCapability(c, "violations.read_project", "Access denied")) {
    return null;
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
    .select()
    .from(violations)
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
    })
    .where(eq(violations.id, violationId))
    .returning();

  if (body.status === "suppressed") {
    await db
      .insert(violation_suppressions)
      .values({
        tenant_id: tenantId,
        project_id: existing.project_id,
        entity_id: existing.entity_id,
        rule_id: existing.rule_id,
        suppressed_by: userId ?? null,
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
    .select()
    .from(violations)
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
          entity_id: row.entity_id,
          rule_id: row.rule_id,
          suppressed_by: userId ?? null,
          reason: body.status_note ?? null,
        })),
      )
      .onConflictDoNothing();
  }

  return { updatedIds: updatedRows.map((row) => row.id) };
}
