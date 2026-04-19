import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  project_findings,
  violation_suppressions,
  violations,
} from "../../db/schema.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";
import {
  getAuthContext,
  requireProjectAccess,
  requireTenantCapability,
} from "../../http/guards.js";
import { findingsQuerySchema } from "./shared.js";

const patchFindingStatusSchema = z.object({
  status: z.enum(["open", "suppressed", "resolved"]),
  status_note: z.string().nullable().optional(),
});

export const projectSecurityFindingsRouter = new Hono();

projectSecurityFindingsRouter.get(
  "/v1/projects/:project_id/findings",
  zValidator("query", findingsQuerySchema),
  async (c) => {
    if (!requireTenantCapability(c, "security.read_project", "Access denied")) {
      return c.res;
    }

    const access = await requireProjectAccess(c);
    if (!access) return c.res;

    const { projectId } = access;
    const { tenantId } = getAuthContext(c);
    const {
      connector_key: connectorKey,
      status,
      severity,
      limit,
      offset,
    } = c.req.valid("query");

    const conditions = [
      eq(project_findings.project_id, projectId),
      eq(project_findings.tenant_id, tenantId),
      ...(connectorKey
        ? [eq(project_findings.connector_key, connectorKey)]
        : []),
      ...(status ? [eq(project_findings.status, status)] : []),
      ...(severity ? [eq(project_findings.severity, severity)] : []),
    ];

    const [rows, [countRow]] = await Promise.all([
      db
        .select()
        .from(project_findings)
        .where(and(...(conditions as [ReturnType<typeof eq>])))
        .orderBy(
          sql`CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END`,
          desc(project_findings.last_seen_at),
        )
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<string>`count(*)` })
        .from(project_findings)
        .where(and(...(conditions as [ReturnType<typeof eq>]))),
    ]);

    let violationCountMap = new Map<string, number>();
    if (rows.length > 0) {
      const entityIds = [...new Set(rows.map((row) => row.entity_id))];
      const countRows = await db
        .select({
          entity_id: violations.entity_id,
          count: sql<string>`count(*)`,
        })
        .from(violations)
        .where(
          and(
            eq(violations.project_id, projectId),
            inArray(violations.entity_id, entityIds),
            eq(violations.status, "open"),
          ),
        )
        .groupBy(violations.entity_id);

      violationCountMap = new Map(
        countRows.map((row) => [row.entity_id, Number(row.count)]),
      );
    }

    const findings = rows.map((row) => ({
      ...row,
      open_violation_count: violationCountMap.get(row.entity_id) ?? 0,
    }));

    return c.json({
      findings,
      pagination: { total: Number(countRow?.count ?? 0), offset, limit },
    });
  },
);

projectSecurityFindingsRouter.patch(
  "/v1/projects/:project_id/findings/:finding_id/status",
  zValidator("json", patchFindingStatusSchema),
  async (c) => {
    const { tenantId, userId } = getAuthContext(c);
    const access = await requireProjectAccess(c);
    if (!access) return c.res;

    const { projectId } = access;
    const findingId = validateUuidParam(c, "finding_id", "Finding ID");
    if (!findingId) return c.res;

    if (!requireTenantCapability(c, "security.write", "Access denied"))
      return c.res;

    const [finding] = await db
      .select()
      .from(project_findings)
      .where(
        and(
          eq(project_findings.id, findingId),
          eq(project_findings.project_id, projectId),
          eq(project_findings.tenant_id, tenantId),
        ),
      )
      .limit(1);

    if (!finding) {
      return errorJson(c, 404, "NOT_FOUND", "Finding not found", findingId);
    }

    const body = c.req.valid("json");
    const now = new Date();

    const [updated] = await db
      .update(project_findings)
      .set({
        status: body.status,
        status_note: body.status_note ?? null,
        status_updated_by: userId ?? null,
        status_updated_at: now,
      })
      .where(eq(project_findings.id, findingId))
      .returning();

    if (body.status === "suppressed") {
      await Promise.all([
        db
          .insert(violation_suppressions)
          .values({
            tenant_id: tenantId,
            project_id: projectId,
            entity_id: finding.entity_id,
            rule_id: null,
            suppressed_by: userId ?? null,
            reason: body.status_note ?? null,
          })
          .onConflictDoNothing(),
        db
          .update(violations)
          .set({ status: "suppressed", status_note: body.status_note ?? null })
          .where(
            and(
              eq(violations.project_id, projectId),
              eq(violations.entity_id, finding.entity_id),
              eq(violations.status, "open"),
            ),
          ),
      ]);
    } else if (body.status === "resolved") {
      await db
        .update(violations)
        .set({ status: "resolved", status_note: body.status_note ?? null })
        .where(
          and(
            eq(violations.project_id, projectId),
            eq(violations.entity_id, finding.entity_id),
            eq(violations.status, "open"),
          ),
        );
    }

    return c.json({ finding: updated });
  },
);
