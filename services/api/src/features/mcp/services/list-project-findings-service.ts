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
    const packageVersionIds = [
      ...new Set(
        rows
          .map((row) => row.package_version_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const [countRows, detailRows] = await Promise.all([
      db
        .select({
          package_version_id: violations.package_version_id,
          count: sql<string>`count(*)`,
        })
        .from(violations)
        .where(
          and(
            eq(violations.project_id, projectId),
            inArray(violations.package_version_id, packageVersionIds),
            eq(violations.status, "open"),
          ),
        )
        .groupBy(violations.package_version_id),
      filters.include_details
        ? Promise.all(
            packageVersionIds.map(
              async (
                packageVersionId,
              ): Promise<
                [string, Awaited<ReturnType<typeof loadViolationFindings>>]
              > => [
                packageVersionId,
                await loadViolationFindings(
                  projectId,
                  ctx.principal.tenantId,
                  packageVersionId,
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
      countRows
        .filter((row) => row.package_version_id)
        .map((row) => [row.package_version_id!, Number(row.count)]),
    );
    findingDetailMap = new Map(detailRows);
  }

  return {
    tenant_id: ctx.principal.tenantId,
    project_id: projectId,
    findings: rows.map((row) => ({
      ...row,
      open_violation_count: row.package_version_id
        ? (violationCountMap.get(row.package_version_id) ?? 0)
        : 0,
      ...(filters.include_details
        ? {
            advisory:
              (row.package_version_id
                ? findingDetailMap.get(row.package_version_id)
                : undefined)
                ?.findings.find(
                  (finding) =>
                    finding.connector_key === row.connector_key &&
                    finding.finding_id === row.finding_id,
                )?.advisory ?? null,
            finding_schema:
              (row.package_version_id
                ? findingDetailMap.get(row.package_version_id)?.findingSchemas[
                    row.connector_key
                  ]
                : undefined) ?? [],
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
