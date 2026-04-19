import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {} from "../../db/schema.js";
import semver from "semver";

type SummaryRow = {
  total_packages: string | number | null;
  critical_count: string | number | null;
  high_count: string | number | null;
  medium_count: string | number | null;
  low_count: string | number | null;
  clean_count: string | number | null;
  unscanned_count: string | number | null;
  fixable_count: string | number | null;
  network_exploitable_count: string | number | null;
  oldest_crit_high_advisory: string | Date | null;
  last_synced_at: Date | null;
  synced_count: number | null;
  new_findings: number | null;
};

type ProjectVersionRow = {
  ecosystem: string;
  name: string;
  versions: string[];
};

type FixCandidateRow = {
  ecosystem: string;
  name: string;
  version: string;
  fix_version: string;
};

export async function loadProjectOsvSummary(
  projectId: string,
  tenantId: string,
) {
  const [summaryRows, projectVersionRows, fixCandidateRows] = await Promise.all(
    [
      db.execute<SummaryRow>(sql`
      SELECT
        COUNT(DISTINCT pv.id)                                                        AS total_packages,
        COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'CRITICAL')           AS critical_count,
        COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'HIGH')               AS high_count,
        COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'MEDIUM')             AS medium_count,
        COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'LOW')                AS low_count,
        COUNT(DISTINCT pv.id) FILTER (WHERE cc.max_severity = 'NONE')               AS clean_count,
        COUNT(DISTINCT pv.id) FILTER (WHERE cc.id IS NULL)                          AS unscanned_count,
        COUNT(DISTINCT pv.id) FILTER (
          WHERE cc.max_severity NOT IN ('NONE') AND cc.max_severity IS NOT NULL
            AND cc.fix_available = true
        )                                                                           AS fixable_count,
        COUNT(DISTINCT pv.id) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(cc.data->'findings', '[]'::jsonb)) AS f
            WHERE f->'attributes' @> '{"attack_vector":"NETWORK"}'::jsonb
          )
        )                                                                           AS network_exploitable_count,
        (
          SELECT MIN((f->>'published_at')::timestamptz)
          FROM project_package_usage ppu2
          JOIN package_versions pv2 ON pv2.id = ppu2.package_version_id
          JOIN packages p2 ON p2.id = pv2.package_id
          JOIN connector_cache cc2
            ON cc2.ecosystem    = p2.ecosystem
           AND cc2.package      = p2.package
           AND cc2.version      = pv2.version
           AND cc2.connector_id = 'osv'
           AND cc2.max_severity IN ('CRITICAL', 'HIGH'),
          jsonb_array_elements(COALESCE(cc2.data->'findings', '[]'::jsonb)) AS f
          WHERE ppu2.project_id = ${projectId}
            AND ppu2.tenant_id  = ${tenantId}
            AND f->>'severity'  IN ('CRITICAL', 'HIGH')
        )                                                                           AS oldest_crit_high_advisory,
        pcs.last_synced_at                                                          AS last_synced_at,
        pcs.synced_count                                                            AS synced_count,
        pcs.new_findings                                                            AS new_findings
      FROM project_package_usage ppu
      JOIN package_versions pv ON pv.id = ppu.package_version_id
      JOIN packages p ON p.id = pv.package_id
      LEFT JOIN connector_cache cc
             ON cc.ecosystem    = p.ecosystem
            AND cc.package      = p.package
            AND cc.version      = pv.version
            AND cc.connector_id = 'osv'
      LEFT JOIN project_connector_syncs pcs
             ON pcs.project_id = ppu.project_id
            AND pcs.connector_key = 'osv'
      WHERE ppu.project_id = ${projectId}
        AND ppu.tenant_id  = ${tenantId}
      GROUP BY ppu.project_id, pcs.last_synced_at, pcs.synced_count, pcs.new_findings
    `),
      db.execute<ProjectVersionRow>(sql`
      SELECT
        p.ecosystem,
        p.package AS name,
        ARRAY_AGG(DISTINCT pv.version) AS versions
      FROM project_package_usage ppu
      JOIN package_versions pv ON pv.id = ppu.package_version_id
      JOIN packages p ON p.id = pv.package_id
      WHERE ppu.project_id = ${projectId}
        AND ppu.tenant_id  = ${tenantId}
      GROUP BY p.ecosystem, p.package
    `),
      db.execute<FixCandidateRow>(sql`
      SELECT DISTINCT
        p.ecosystem,
        p.package   AS name,
        pv.version,
        f->>'fix_version' AS fix_version
      FROM project_package_usage ppu
      JOIN package_versions pv ON pv.id = ppu.package_version_id
      JOIN packages p ON p.id = pv.package_id
      JOIN connector_cache cc
        ON cc.ecosystem    = p.ecosystem
       AND cc.package      = p.package
       AND cc.version      = pv.version
       AND cc.connector_id = 'osv',
      jsonb_array_elements(COALESCE(cc.data->'findings', '[]'::jsonb)) AS f
      WHERE ppu.project_id = ${projectId}
        AND ppu.tenant_id  = ${tenantId}
        AND f->>'fix_version' IS NOT NULL
        AND f->>'fix_version' != ''
    `),
    ],
  );

  const versionMap = new Map<string, string[]>();
  for (const row of projectVersionRows) {
    versionMap.set(`${row.ecosystem}|${row.name}`, row.versions ?? []);
  }

  const fixNotAppliedSet = new Set<string>();
  for (const candidate of fixCandidateRows) {
    if (!candidate.fix_version) continue;

    const pulledVersions =
      versionMap.get(`${candidate.ecosystem}|${candidate.name}`) ?? [];

    const resolved =
      candidate.ecosystem === "npm"
        ? pulledVersions.some((version) => {
            const cleanVersion = semver.valid(semver.coerce(version));
            const cleanFix = semver.valid(semver.coerce(candidate.fix_version));
            return (
              cleanVersion && cleanFix && semver.gte(cleanVersion, cleanFix)
            );
          })
        : pulledVersions.includes(candidate.fix_version);

    if (!resolved) {
      fixNotAppliedSet.add(
        `${candidate.ecosystem}|${candidate.name}|${candidate.version}`,
      );
    }
  }

  return {
    summary: (summaryRows[0] ?? {}) as Record<string, unknown>,
    fixNotAppliedSet,
  };
}
