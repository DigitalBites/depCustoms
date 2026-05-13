import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { connector_cache } from "../../db/schema.js";
import type { CacheFinding } from "../../connectors/cache.js";

type EntityContextRow = {
  package_version_id: string;
  dispositions: Array<{
    connectorKey: string;
    id: string;
    findingId: string;
    severity: string;
    observationStatus: string;
  }> | null;
  open_violation_count: string | number | null;
};

export async function loadProjectPackageFindingContext(
  projectId: string,
  tenantId: string,
  cacheIds: string[],
  packageVersionIds: string[],
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
          pf.package_version_id,
          json_agg(
            json_build_object(
              'id', pf.id,
              'connectorKey', f.connector_key,
              'findingId', f.external_finding_id,
              'severity', fv.severity,
              'observationStatus', 'observed'
            )
            ORDER BY CASE fv.severity
              WHEN 'CRITICAL' THEN 0
              WHEN 'HIGH' THEN 1
              WHEN 'MEDIUM' THEN 2
              WHEN 'LOW' THEN 3
              ELSE 4
            END
          ) AS dispositions
        FROM project_findings pf
        JOIN findings f ON f.finding_key = pf.finding_key
        JOIN finding_versions fv ON fv.id = pf.current_finding_version_id
        WHERE pf.project_id = ${projectId}
          AND pf.tenant_id = ${tenantId}
          AND pf.observed_to > now()
          AND pf.package_version_id = ANY(ARRAY[${sql.join(
            packageVersionIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}])
        GROUP BY pf.package_version_id
      ),
      violation_counts AS (
        SELECT
          v.package_version_id,
          count(*) AS open_violation_count
        FROM violations v
        WHERE v.project_id = ${projectId}
          AND v.tenant_id = ${tenantId}
          AND v.status = 'open'
          AND v.package_version_id = ANY(ARRAY[${sql.join(
            packageVersionIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}])
        GROUP BY v.package_version_id
      )
      SELECT
        entities.package_version_id,
        dr.dispositions,
        COALESCE(vc.open_violation_count, 0) AS open_violation_count
      FROM (
        SELECT unnest(ARRAY[${sql.join(
          packageVersionIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}]) AS package_version_id
      ) entities
      LEFT JOIN disposition_rows dr ON dr.package_version_id = entities.package_version_id
      LEFT JOIN violation_counts vc ON vc.package_version_id = entities.package_version_id
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
