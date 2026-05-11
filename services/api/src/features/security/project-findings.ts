import { and, eq, sql } from "drizzle-orm";
import type { db } from "../../db/index.js";
import { project_findings } from "../../db/schema.js";

type ProjectFindingInput = {
  findingId: string;
  severity: string;
  title: string | null;
};

export async function upsertProjectFindingsForEntity(
  dbHandle: typeof db,
  input: {
    tenantId: string;
    projectId: string;
    connectorKey: string;
    packageId: string | null;
    packageVersionId: string | null;
    findings: ProjectFindingInput[];
  },
) {
  const {
    tenantId,
    projectId,
    connectorKey,
    packageId,
    packageVersionId,
    findings,
  } = input;

  if (findings.length === 0 || !packageId) {
    return { newFindings: 0 };
  }

  let newFindings = 0;
  const now = new Date();

  for (const finding of findings) {
    const [existing] = await dbHandle
      .select({
        id: project_findings.id,
      })
      .from(project_findings)
      .where(
        and(
          eq(project_findings.project_id, projectId),
          eq(project_findings.connector_key, connectorKey),
          eq(project_findings.package_id, packageId),
          packageVersionId
            ? eq(
                project_findings.package_version_id,
                packageVersionId,
              )
            : sql`${project_findings.package_version_id} IS NULL`,
          eq(project_findings.finding_id, finding.findingId),
        ),
      )
      .limit(1);

    if (!existing) {
      newFindings++;
    }

    await dbHandle
      .insert(project_findings)
      .values({
        tenant_id: tenantId,
        project_id: projectId,
        connector_key: connectorKey,
        package_id: packageId,
        package_version_id: packageVersionId,
        finding_id: finding.findingId,
        severity: finding.severity,
        title: finding.title,
        status: "open",
        first_seen_at: now,
        last_seen_at: now,
      })
      .onConflictDoUpdate({
        target: [
          project_findings.project_id,
          project_findings.connector_key,
          project_findings.package_id,
          project_findings.package_version_id,
          project_findings.finding_id,
        ],
        set: {
          severity: finding.severity,
          title: finding.title,
          package_id: packageId,
          package_version_id: packageVersionId,
          last_seen_at: now,
          status: sql`CASE WHEN ${project_findings.status} = 'resolved' THEN 'open' ELSE ${project_findings.status} END`,
        },
      });
  }

  return { newFindings };
}
