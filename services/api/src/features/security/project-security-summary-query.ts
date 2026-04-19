import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";

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

  const rows = await db.execute<ProjectSecuritySummaryRow>(sql`
    WITH findings AS (
      SELECT
        COUNT(*) FILTER (WHERE status = 'open') AS open_count,
        COUNT(*) FILTER (WHERE status = 'suppressed') AS suppressed_count,
        COUNT(*) FILTER (
          WHERE status = 'open' AND severity = 'CRITICAL'
        ) AS critical_open_count,
        COUNT(*) FILTER (
          WHERE status = 'open' AND severity = 'HIGH'
        ) AS high_open_count,
        COUNT(*) FILTER (
          WHERE status = 'open' AND severity = 'MEDIUM'
        ) AS medium_open_count,
        COUNT(*) FILTER (
          WHERE status = 'open' AND severity = 'LOW'
        ) AS low_open_count,
        MIN(first_seen_at) FILTER (WHERE status = 'open') AS oldest_open_at
      FROM project_findings
      WHERE project_id = ${projectId}
        AND tenant_id = ${tenantId}
    ),
    blocked_violations AS (
      SELECT
        COUNT(*) FILTER (
          WHERE evaluated_at >= ${day30Ago.toISOString()}::timestamptz
        ) AS blocks_30d,
        COUNT(*) FILTER (
          WHERE evaluated_at >= ${day7Ago.toISOString()}::timestamptz
        ) AS blocks_7d,
        COUNT(*) FILTER (
          WHERE evaluated_at >= ${day14Ago.toISOString()}::timestamptz
            AND evaluated_at <= ${day7Ago.toISOString()}::timestamptz
        ) AS blocks_prior_7d
      FROM violations
      WHERE project_id = ${projectId}
        AND tenant_id = ${tenantId}
        AND blocked = true
    ),
    suppressions AS (
      SELECT COUNT(*) AS suppressions_count
      FROM violation_suppressions
      WHERE tenant_id = ${tenantId}
        AND (project_id = ${projectId} OR project_id IS NULL)
    ),
    sync_summary AS (
      SELECT
        last_synced_at,
        new_findings,
        synced_count
      FROM project_connector_syncs
      WHERE project_id = ${projectId}
        AND connector_key = 'osv'
      LIMIT 1
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
    LEFT JOIN sync_summary
      ON true
  `);

  return rows[0] ?? null;
}
