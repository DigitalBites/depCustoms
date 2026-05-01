import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  project_connector_syncs,
  project_findings,
  violation_suppressions,
  violations,
} from "../../db/schema.js";

type ProjectSecuritySummaryRow = {
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
  new_findings: number | null;
  synced_count: number | null;
};

export async function loadProjectSecuritySummaryRow(
  projectId: string,
  tenantId: string,
  now = new Date(),
) {
  const day7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day14Ago = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

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
        .where(
          and(
            eq(project_findings.project_id, projectId),
            eq(project_findings.tenant_id, tenantId),
          ),
        ),
      db
        .select({
          blocks_30d: sql<string>`count(*) filter (where ${violations.last_seen_at} >= ${day30Ago.toISOString()}::timestamptz)`,
          blocks_7d: sql<string>`count(*) filter (where ${violations.last_seen_at} >= ${day7Ago.toISOString()}::timestamptz)`,
          blocks_prior_7d: sql<string>`count(*) filter (where ${violations.last_seen_at} >= ${day14Ago.toISOString()}::timestamptz and ${violations.last_seen_at} <= ${day7Ago.toISOString()}::timestamptz)`,
        })
        .from(violations)
        .where(
          and(
            eq(violations.project_id, projectId),
            eq(violations.tenant_id, tenantId),
            eq(violations.blocked, true),
          ),
        ),
      db
        .select({ suppressions_count: sql<string>`count(*)` })
        .from(violation_suppressions)
        .where(
          and(
            eq(violation_suppressions.tenant_id, tenantId),
            or(
              eq(violation_suppressions.project_id, projectId),
              isNull(violation_suppressions.project_id),
            ),
          ),
        ),
      db
        .select({
          last_synced_at: project_connector_syncs.last_synced_at,
          new_findings: project_connector_syncs.new_findings,
          synced_count: project_connector_syncs.synced_count,
        })
        .from(project_connector_syncs)
        .where(
          and(
            eq(project_connector_syncs.project_id, projectId),
            eq(project_connector_syncs.connector_key, "osv"),
          ),
        )
        .limit(1),
    ]);

  const findings = findingsRows[0];
  const blocked = blockedRows[0];
  const suppressions = suppressionRows[0];
  if (!findings || !blocked || !suppressions) return null;

  return {
    ...findings,
    ...blocked,
    ...suppressions,
    last_synced_at: syncRows[0]?.last_synced_at ?? null,
    new_findings: syncRows[0]?.new_findings ?? null,
    synced_count: syncRows[0]?.synced_count ?? null,
  } satisfies ProjectSecuritySummaryRow;
}
