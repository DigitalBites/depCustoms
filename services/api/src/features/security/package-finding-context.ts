import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { connector_cache } from "../../db/schema.js";
import type { CacheFinding } from "../../connectors/cache.js";

type EntityContextRow = {
  entity_id: string;
  dispositions: Array<{
    connectorKey: string;
    id: string;
    entityId: string;
    findingId: string;
    severity: string;
    status: string;
    statusNote: string | null;
  }> | null;
  open_violation_count: string | number | null;
};

export async function loadProjectPackageFindingContext(
  projectId: string,
  tenantId: string,
  cacheIds: string[],
  entityIds: string[],
) {
  const [cacheRows, entityContextRows] = await Promise.all([
    cacheIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: connector_cache.id, data: connector_cache.data })
          .from(connector_cache)
          .where(
            and(
              inArray(connector_cache.id, cacheIds),
              eq(connector_cache.connector_id, "osv"),
            ),
          ),
    db.execute<EntityContextRow>(sql`
      WITH disposition_rows AS (
        SELECT
          pf.entity_id,
          json_agg(
            json_build_object(
              'id', pf.id,
              'connectorKey', pf.connector_key,
              'entityId', pf.entity_id,
              'findingId', pf.finding_id,
              'severity', pf.severity,
              'status', pf.status,
              'statusNote', pf.status_note
            )
            ORDER BY CASE pf.severity
              WHEN 'CRITICAL' THEN 0
              WHEN 'HIGH' THEN 1
              WHEN 'MEDIUM' THEN 2
              WHEN 'LOW' THEN 3
              ELSE 4
            END
          ) AS dispositions
        FROM project_findings pf
        WHERE pf.project_id = ${projectId}
          AND pf.tenant_id = ${tenantId}
          AND pf.entity_id IN (${sql.join(
            entityIds.map((id) => sql`${id}`),
            sql`, `,
          )})
        GROUP BY pf.entity_id
      ),
      violation_counts AS (
        SELECT
          v.entity_id,
          count(*) AS open_violation_count
        FROM violations v
        WHERE v.project_id = ${projectId}
          AND v.tenant_id = ${tenantId}
          AND v.status = 'open'
          AND v.entity_id IN (${sql.join(
            entityIds.map((id) => sql`${id}`),
            sql`, `,
          )})
        GROUP BY v.entity_id
      )
      SELECT
        entities.entity_id,
        dr.dispositions,
        COALESCE(vc.open_violation_count, 0) AS open_violation_count
      FROM (
        SELECT unnest(ARRAY[${sql.join(
          entityIds.map((id) => sql`${id}`),
          sql`, `,
        )}]) AS entity_id
      ) entities
      LEFT JOIN disposition_rows dr ON dr.entity_id = entities.entity_id
      LEFT JOIN violation_counts vc ON vc.entity_id = entities.entity_id
    `),
  ]);

  // Extract findings from data JSONB, grouped by cache row id
  const cacheFindings = cacheRows.flatMap((row) => {
    const findings =
      (row.data as { findings?: CacheFinding[] } | null)?.findings ?? [];
    return findings.map((f) => ({
      cacheId: row.id,
      findingId: f.id,
      severity: f.severity,
      title: f.title,
      publishedAt: f.published_at ? new Date(f.published_at) : null,
      attributes: f.attributes,
    }));
  });

  return { cacheFindings, entityContextRows };
}
