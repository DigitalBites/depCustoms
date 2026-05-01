import { and, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import type { violations } from "../../db/schema.js";
import { project_findings, projects } from "../../db/schema.js";

export type EnrichedViolation = typeof violations.$inferSelect & {
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
  const entityIds = [...new Set(rows.map((row) => row.entity_id))];

  const [projectRows, findingCountRows] = await Promise.all([
    projectIds.length > 0
      ? db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, projectIds))
      : [],
    projectIds.length > 0 && entityIds.length > 0
      ? db
          .select({
            project_id: project_findings.project_id,
            entity_id: project_findings.entity_id,
            count: sql<string>`count(*)`,
          })
          .from(project_findings)
          .where(
            and(
              inArray(project_findings.project_id, projectIds),
              inArray(project_findings.entity_id, entityIds),
              eq(project_findings.status, "open"),
            ),
          )
          .groupBy(project_findings.project_id, project_findings.entity_id)
      : [],
  ]);

  const projectMap = new Map(projectRows.map((row) => [row.id, row.name]));
  const findingCountMap = new Map(
    (
      findingCountRows as {
        project_id: string;
        entity_id: string;
        count: string;
      }[]
    ).map((row) => [`${row.project_id}|${row.entity_id}`, Number(row.count)]),
  );

  return rows.map((row) => ({
    ...row,
    project_name: projectMap.get(row.project_id) ?? null,
    finding_count:
      findingCountMap.get(`${row.project_id}|${row.entity_id}`) ?? 0,
  }));
}
