import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";

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

  const projectFindingsScope =
    allowedProjectIds === null
      ? sql`pf.tenant_id = ${tenantId}`
      : allowedProjectIds.length > 0
        ? sql`pf.tenant_id = ${tenantId} AND pf.project_id IN (${sql.join(
            allowedProjectIds.map((projectId) => sql`${projectId}`),
            sql`, `,
          )})`
        : sql`false`;
  const violationsScope =
    allowedProjectIds === null
      ? sql`v.tenant_id = ${tenantId}`
      : allowedProjectIds.length > 0
        ? sql`v.tenant_id = ${tenantId} AND v.project_id IN (${sql.join(
            allowedProjectIds.map((projectId) => sql`${projectId}`),
            sql`, `,
          )})`
        : sql`false`;
  const suppressionsScope =
    allowedProjectIds === null
      ? sql`vs.tenant_id = ${tenantId}`
      : allowedProjectIds.length > 0
        ? sql`vs.tenant_id = ${tenantId} AND (vs.project_id IS NULL OR vs.project_id IN (${sql.join(
            allowedProjectIds.map((projectId) => sql`${projectId}`),
            sql`, `,
          )}))`
        : sql`vs.tenant_id = ${tenantId} AND vs.project_id IS NULL`;
  const syncScope =
    allowedProjectIds === null
      ? sql`pcs.project_id = p.id AND p.tenant_id = ${tenantId}`
      : allowedProjectIds.length > 0
        ? sql`pcs.project_id = p.id AND p.tenant_id = ${tenantId} AND p.id IN (${sql.join(
            allowedProjectIds.map((projectId) => sql`${projectId}`),
            sql`, `,
          )})`
        : sql`false`;

  const rows = await db.execute<TenantSecuritySummaryRow>(sql`
    WITH findings AS (
      SELECT
        COUNT(*) FILTER (WHERE pf.status = 'open') AS open_count,
        COUNT(*) FILTER (WHERE pf.status = 'suppressed') AS suppressed_count,
        COUNT(*) FILTER (
          WHERE pf.status = 'open' AND pf.severity = 'CRITICAL'
        ) AS critical_open_count,
        COUNT(*) FILTER (
          WHERE pf.status = 'open' AND pf.severity = 'HIGH'
        ) AS high_open_count,
        COUNT(*) FILTER (
          WHERE pf.status = 'open' AND pf.severity = 'MEDIUM'
        ) AS medium_open_count,
        COUNT(*) FILTER (
          WHERE pf.status = 'open' AND pf.severity = 'LOW'
        ) AS low_open_count,
        MIN(pf.first_seen_at) FILTER (WHERE pf.status = 'open') AS oldest_open_at
      FROM project_findings pf
      WHERE ${projectFindingsScope}
    ),
    blocked_violations AS (
      SELECT
        COUNT(*) FILTER (
          WHERE v.evaluated_at >= ${day30Ago.toISOString()}::timestamptz
        ) AS blocks_30d,
        COUNT(*) FILTER (
          WHERE v.evaluated_at >= ${day7Ago.toISOString()}::timestamptz
        ) AS blocks_7d,
        COUNT(*) FILTER (
          WHERE v.evaluated_at >= ${day14Ago.toISOString()}::timestamptz
            AND v.evaluated_at <= ${day7Ago.toISOString()}::timestamptz
        ) AS blocks_prior_7d
      FROM violations v
      WHERE ${violationsScope}
        AND v.blocked = true
    ),
    suppressions AS (
      SELECT COUNT(*) AS suppressions_count
      FROM violation_suppressions vs
      WHERE ${suppressionsScope}
    ),
    sync_summary AS (
      SELECT
        MAX(pcs.last_synced_at) AS last_synced_at,
        COALESCE(SUM(pcs.new_findings), 0) AS new_findings,
        COALESCE(SUM(pcs.synced_count), 0) AS synced_count
      FROM project_connector_syncs pcs
      JOIN projects p ON ${syncScope}
      WHERE pcs.connector_key = 'osv'
    )
    SELECT
      findings.open_count,
      findings.suppressed_count,
      findings.critical_open_count,
      findings.high_open_count,
      findings.medium_open_count,
      findings.low_open_count,
      findings.oldest_open_at,
      blocked_violations.blocks_30d,
      blocked_violations.blocks_7d,
      blocked_violations.blocks_prior_7d,
      suppressions.suppressions_count,
      sync_summary.last_synced_at,
      sync_summary.new_findings,
      sync_summary.synced_count
    FROM findings
    CROSS JOIN blocked_violations
    CROSS JOIN suppressions
    CROSS JOIN sync_summary
  `);

  return rows[0] ?? null;
}
