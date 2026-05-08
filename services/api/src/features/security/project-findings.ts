import { and, eq, sql } from "drizzle-orm";
import type { db } from "../../db/index.js";
import { project_findings } from "../../db/schema.js";
import { resolveArtifactIdentity } from "../packages/artifact-identity.js";
import { parsePackageEntityId } from "../packages/identity.js";

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
    entityId: string;
    findings: ProjectFindingInput[];
  },
) {
  const { tenantId, projectId, connectorKey, entityId, findings } = input;

  if (findings.length === 0) {
    return { newFindings: 0 };
  }

  let newFindings = 0;
  const now = new Date();
  const parsedIdentity = parsePackageEntityId(entityId);
  const artifactIdentity = parsedIdentity
    ? await resolveArtifactIdentity(dbHandle, {
        ...parsedIdentity,
        source: "project_findings",
      })
    : null;
  if (!artifactIdentity?.package_id) {
    return { newFindings: 0 };
  }

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
          eq(project_findings.package_id, artifactIdentity.package_id),
          artifactIdentity.package_version_id
            ? eq(
                project_findings.package_version_id,
                artifactIdentity.package_version_id,
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
        package_id: artifactIdentity?.package_id ?? null,
        package_version_id: artifactIdentity?.package_version_id ?? null,
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
          package_id: artifactIdentity?.package_id ?? null,
          package_version_id: artifactIdentity?.package_version_id ?? null,
          last_seen_at: now,
          status: sql`CASE WHEN ${project_findings.status} = 'resolved' THEN 'open' ELSE ${project_findings.status} END`,
        },
      });
  }

  return { newFindings };
}
