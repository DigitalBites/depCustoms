import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../../db/index.js";
import { project_findings, violations } from "../../../db/schema.js";
import type { McpRequestContext } from "../context.js";
import { requireMcpProjectAccess } from "./project-access.js";
import { loadViolationFindings } from "../../violations/finding-details.js";

type FindingsFilters = {
  connector_key?: string;
  status?: string;
  severity?: string;
  include_details?: boolean;
  limit?: number;
  offset?: number;
};

export async function listProjectFindingsForMcp(
  ctx: McpRequestContext,
  projectId: string,
  filters: FindingsFilters,
) {
  await requireMcpProjectAccess(ctx.principal, projectId);

  const conditions = [
    eq(project_findings.project_id, projectId),
    eq(project_findings.tenant_id, ctx.principal.tenantId),
    ...(filters.connector_key
      ? [eq(project_findings.connector_key, filters.connector_key)]
      : []),
    ...(filters.status ? [eq(project_findings.status, filters.status)] : []),
    ...(filters.severity
      ? [eq(project_findings.severity, filters.severity)]
      : []),
  ];

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const [rows, [countRow]] = await Promise.all([
    db
      .select()
      .from(project_findings)
      .where(
        and(
          ...(conditions as [
            ReturnType<typeof eq>,
            ...ReturnType<typeof eq>[],
          ]),
        ),
      )
      .orderBy(
        sql`CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END`,
        desc(project_findings.last_seen_at),
      )
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<string>`count(*)` })
      .from(project_findings)
      .where(
        and(
          ...(conditions as [
            ReturnType<typeof eq>,
            ...ReturnType<typeof eq>[],
          ]),
        ),
      ),
  ]);

  let violationCountMap = new Map<string, number>();
  let findingDetailMap = new Map<
    string,
    Awaited<ReturnType<typeof loadViolationFindings>>
  >();
  if (rows.length > 0) {
    const entityIds = [...new Set(rows.map((row) => row.entity_id))];
    const [countRows, detailRows] = await Promise.all([
      db
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
        .groupBy(violations.entity_id),
      filters.include_details
        ? Promise.all(
            entityIds.map(
              async (
                entityId,
              ): Promise<
                [string, Awaited<ReturnType<typeof loadViolationFindings>>]
              > => [
                entityId,
                await loadViolationFindings(
                  projectId,
                  ctx.principal.tenantId,
                  entityId,
                ),
              ],
            ),
          )
        : Promise.resolve(
            [] as Array<
              [string, Awaited<ReturnType<typeof loadViolationFindings>>]
            >,
          ),
    ]);

    violationCountMap = new Map(
      countRows.map((row) => [row.entity_id, Number(row.count)]),
    );
    findingDetailMap = new Map(detailRows);
  }

  return {
    tenant_id: ctx.principal.tenantId,
    project_id: projectId,
    findings: rows.map((row) => ({
      ...row,
      open_violation_count: violationCountMap.get(row.entity_id) ?? 0,
      ...(filters.include_details
        ? {
            advisory:
              findingDetailMap
                .get(row.entity_id)
                ?.findings.find(
                  (finding) =>
                    finding.connector_key === row.connector_key &&
                    finding.finding_id === row.finding_id,
                )?.advisory ?? null,
            finding_schema:
              findingDetailMap.get(row.entity_id)?.findingSchemas[
                row.connector_key
              ] ?? [],
          }
        : {}),
    })),
    pagination: {
      total: Number(countRow?.count ?? 0),
      offset,
      limit,
    },
  };
}
