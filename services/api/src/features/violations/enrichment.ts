import { and, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import type { violations } from "../../db/schema.js";
import { project_findings, projects } from "../../db/schema.js";
import { loadArtifactIdentityByCatalogIds } from "../packages/artifact-identity.js";

export type EnrichedViolation = typeof violations.$inferSelect & {
  ecosystem: string | null;
  package_name: string | null;
  version: string | null;
  display_name: string;
  project_name: string | null;
  finding_count: number;
};

export async function enrichViolations(
  rows: (typeof violations.$inferSelect)[],
) {
  if (rows.length === 0) return rows as EnrichedViolation[];

  const projectIds = [
    ...new Set(rows.map((row) => row.project_id).filter(Boolean)),
  ];
  const packageVersionIds = [
    ...new Set(
      rows
        .map((row) => row.package_version_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [projectRows, findingCountRows] = await Promise.all([
    projectIds.length > 0
      ? db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, projectIds))
      : [],
    projectIds.length > 0 && packageVersionIds.length > 0
      ? db
          .select({
            project_id: project_findings.project_id,
            package_version_id: project_findings.package_version_id,
            count: sql<string>`count(*)`,
          })
          .from(project_findings)
          .where(
            and(
              inArray(project_findings.project_id, projectIds),
              inArray(project_findings.package_version_id, packageVersionIds),
              sql`${project_findings.observed_to} > now()`,
            ),
          )
          .groupBy(
            project_findings.project_id,
            project_findings.package_version_id,
          )
      : [],
  ]);

  const projectMap = new Map(projectRows.map((row) => [row.id, row.name]));
  const findingCountMap = new Map(
    (
      findingCountRows as {
        project_id: string;
        package_version_id: string;
        count: string;
      }[]
    ).map((row) => [
      `${row.project_id}|${row.package_version_id}`,
      Number(row.count),
    ]),
  );
  const identityRows = await Promise.all(
    rows.map((row) =>
      loadArtifactIdentityByCatalogIds(db, {
        package_id: row.package_id,
        package_version_id: row.package_version_id,
        source: "violation_enrichment",
      }),
    ),
  );

  return rows.map((row, index) => {
    const identity = identityRows[index];
    return {
      ...row,
      ecosystem: identity?.ecosystem ?? null,
      package_name: identity?.package ?? null,
      version: identity?.version ?? null,
      display_name: identity?.display_name ?? "",
      project_name: projectMap.get(row.project_id) ?? null,
      finding_count: row.package_version_id
        ? (findingCountMap.get(`${row.project_id}|${row.package_version_id}`) ??
          0)
        : 0,
    };
  });
}
