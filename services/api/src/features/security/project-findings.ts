import { and, eq, sql } from "drizzle-orm";
import type { db } from "../../db/index.js";
import { project_findings } from "../../db/schema.js";
import { resolvePackageCatalogReferenceForEntityId } from "../packages/catalog-references.js";

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
  const catalogReference = await resolvePackageCatalogReferenceForEntityId(
    dbHandle,
    entityId,
  );

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
          eq(project_findings.entity_id, entityId),
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
        entity_id: entityId,
        package_id: catalogReference.package_id,
        package_version_id: catalogReference.package_version_id,
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
          project_findings.entity_id,
          project_findings.finding_id,
        ],
        set: {
          severity: finding.severity,
          title: finding.title,
          package_id: catalogReference.package_id,
          package_version_id: catalogReference.package_version_id,
          last_seen_at: now,
          status: sql`CASE WHEN ${project_findings.status} = 'resolved' THEN 'open' ELSE ${project_findings.status} END`,
        },
      });
  }

  return { newFindings };
}
