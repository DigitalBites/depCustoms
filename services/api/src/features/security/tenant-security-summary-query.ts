import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  project_connector_syncs,
  project_findings,
  projects,
  violation_suppressions,
  violations,
} from "../../db/schema.js";

type TenantSecuritySummaryRow = {
  open_count: string | number | null;
  suppressed_count: string | number | null;
  critical_open_count: string | number | null;
  high_open_count: string | number | null;
  medium_open_count: string | number | null;
  low_open_count: string | number | null;
  oldest_open_at: string | Date | null;
  blocks_30d: string | number | null;
  blocks_7d: string | number | null;
  blocks_prior_7d: string | number | null;
  suppressions_count: string | number | null;
  last_synced_at: Date | null;
  new_findings: string | number | null;
  synced_count: string | number | null;
};

export async function loadTenantSecuritySummaryRow(
  tenantId: string,
  allowedProjectIds: string[] | null = null,
  now = new Date(),
) {
  const day7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day14Ago = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const projectScope =
    allowedProjectIds === null
      ? undefined
      : allowedProjectIds.length > 0
        ? allowedProjectIds
        : null;

  const projectFindingsScope = and(
    eq(project_findings.tenant_id, tenantId),
    projectScope === undefined
      ? undefined
      : projectScope === null
        ? sql`false`
        : inArray(project_findings.project_id, projectScope),
  );
  const violationsScope = and(
    eq(violations.tenant_id, tenantId),
    projectScope === undefined
      ? undefined
      : projectScope === null
        ? sql`false`
        : inArray(violations.project_id, projectScope),
  );
  const suppressionsScope = and(
    eq(violation_suppressions.tenant_id, tenantId),
    projectScope === undefined
      ? undefined
      : projectScope === null
        ? isNull(violation_suppressions.project_id)
        : or(
            isNull(violation_suppressions.project_id),
            inArray(violation_suppressions.project_id, projectScope),
          ),
  );
  const syncScope = and(
    eq(project_connector_syncs.project_id, projects.id),
    eq(projects.tenant_id, tenantId),
    projectScope === undefined
      ? undefined
      : projectScope === null
        ? sql`false`
        : inArray(projects.id, projectScope),
  );

  const [findingsRows, blockedRows, suppressionRows, syncRows] =
    await Promise.all([
      db
        .select({
          open_count: sql<string>`count(*) filter (where ${project_findings.status} = 'open')`,
          suppressed_count: sql<string>`count(*) filter (where ${project_findings.status} = 'suppressed')`,
          critical_open_count: sql<string>`count(*) filter (where ${project_findings.status} = 'open' and ${project_findings.severity} = 'CRITICAL')`,
          high_open_count: sql<string>`count(*) filter (where ${project_findings.status} = 'open' and ${project_findings.severity} = 'HIGH')`,
          medium_open_count: sql<string>`count(*) filter (where ${project_findings.status} = 'open' and ${project_findings.severity} = 'MEDIUM')`,
          low_open_count: sql<string>`count(*) filter (where ${project_findings.status} = 'open' and ${project_findings.severity} = 'LOW')`,
          oldest_open_at: sql<Date | null>`min(${project_findings.first_seen_at}) filter (where ${project_findings.status} = 'open')`,
        })
        .from(project_findings)
        .where(projectFindingsScope),
      db
        .select({
          blocks_30d: sql<string>`count(*) filter (where ${violations.last_seen_at} >= ${day30Ago.toISOString()}::timestamptz)`,
          blocks_7d: sql<string>`count(*) filter (where ${violations.last_seen_at} >= ${day7Ago.toISOString()}::timestamptz)`,
          blocks_prior_7d: sql<string>`count(*) filter (where ${violations.last_seen_at} >= ${day14Ago.toISOString()}::timestamptz and ${violations.last_seen_at} <= ${day7Ago.toISOString()}::timestamptz)`,
        })
        .from(violations)
        .where(and(violationsScope, eq(violations.blocked, true))),
      db
        .select({ suppressions_count: sql<string>`count(*)` })
        .from(violation_suppressions)
        .where(suppressionsScope),
      db
        .select({
          last_synced_at: sql<Date | null>`max(${project_connector_syncs.last_synced_at})`,
          new_findings: sql<string>`coalesce(sum(${project_connector_syncs.new_findings}), 0)`,
          synced_count: sql<string>`coalesce(sum(${project_connector_syncs.synced_count}), 0)`,
        })
        .from(project_connector_syncs)
        .innerJoin(projects, syncScope)
        .where(eq(project_connector_syncs.connector_key, "osv")),
    ]);

  const findings = findingsRows[0];
  const blocked = blockedRows[0];
  const suppressions = suppressionRows[0];
  const sync = syncRows[0];
  if (!findings || !blocked || !suppressions || !sync) return null;

  return {
    ...findings,
    ...blocked,
    ...suppressions,
    ...sync,
  } satisfies TenantSecuritySummaryRow;
}
