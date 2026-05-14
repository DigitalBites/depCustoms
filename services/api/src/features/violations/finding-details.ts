import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  connector_cache,
  connector_snapshots,
  findings as findings_table,
  finding_versions,
  project_findings,
  violation_findings,
} from "../../db/schema.js";
import { getConnectors } from "../../connectors/runtime.js";
import type {
  ConnectorFindingField,
  ConnectorPresentation,
  ConnectorResult,
  ConnectorSnapshot,
} from "../../connectors/types.js";
import { loadArtifactIdentityByCatalogIds } from "../packages/artifact-identity.js";

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  NONE: 0,
};

export async function loadViolationFindings(
  projectId: string,
  tenantId: string,
  packageVersionId: string | null,
  violationId?: string,
) {
  if (!packageVersionId) {
    return { findings: [], findingSchemas: {}, presentations: {} };
  }

  const projectFindings = violationId
    ? await db
        .select({
          id: project_findings.id,
          tenant_id: project_findings.tenant_id,
          project_id: project_findings.project_id,
          package_id: project_findings.package_id,
          package_version_id: project_findings.package_version_id,
          finding_key: project_findings.finding_key,
          current_finding_version_id:
            project_findings.current_finding_version_id,
          observed_from: project_findings.observed_from,
          observed_to: project_findings.observed_to,
          last_seen_at: project_findings.last_seen_at,
          created_at: project_findings.created_at,
          connector_key: findings_table.connector_key,
          finding_id: findings_table.external_finding_id,
          severity: finding_versions.severity,
          title: finding_versions.title,
          connector_cache_id: violation_findings.connector_cache_id,
          raw_attributes: finding_versions.raw_attributes,
        })
        .from(violation_findings)
        .innerJoin(
          project_findings,
          eq(violation_findings.project_finding_id, project_findings.id),
        )
        .innerJoin(
          findings_table,
          eq(project_findings.finding_key, findings_table.finding_key),
        )
        .innerJoin(
          finding_versions,
          eq(violation_findings.finding_version_id, finding_versions.id),
        )
        .where(
          and(
            eq(violation_findings.violation_id, violationId),
            eq(violation_findings.project_id, projectId),
            eq(violation_findings.tenant_id, tenantId),
          ),
        )
    : await db
        .select({
          id: project_findings.id,
          tenant_id: project_findings.tenant_id,
          project_id: project_findings.project_id,
          package_id: project_findings.package_id,
          package_version_id: project_findings.package_version_id,
          finding_key: project_findings.finding_key,
          current_finding_version_id:
            project_findings.current_finding_version_id,
          observed_from: project_findings.observed_from,
          observed_to: project_findings.observed_to,
          last_seen_at: project_findings.last_seen_at,
          created_at: project_findings.created_at,
          connector_key: findings_table.connector_key,
          finding_id: findings_table.external_finding_id,
          severity: finding_versions.severity,
          title: finding_versions.title,
          connector_cache_id: finding_versions.connector_cache_id,
          raw_attributes: finding_versions.raw_attributes,
        })
        .from(project_findings)
        .innerJoin(
          findings_table,
          eq(project_findings.finding_key, findings_table.finding_key),
        )
        .innerJoin(
          finding_versions,
          eq(project_findings.current_finding_version_id, finding_versions.id),
        )
        .where(
          and(
            eq(project_findings.project_id, projectId),
            eq(project_findings.tenant_id, tenantId),
            eq(project_findings.package_version_id, packageVersionId),
          ),
        );

  if (projectFindings.length === 0) {
    return { findings: [], findingSchemas: {}, presentations: {} };
  }

  const resolvedPackageVersionId = packageVersionId;
  const artifactIdentity = await loadArtifactIdentityByCatalogIds(db, {
    package_id: null,
    package_version_id: resolvedPackageVersionId,
    source: "violation_finding_details",
  });
  const enrichedFindings = projectFindings.map((finding) => {
    return {
      ...finding,
      observation_status: "observed",
      advisory: {
        published_at:
          (finding.raw_attributes as { published_at?: string | null } | null)
            ?.published_at ?? null,
        attributes: finding.raw_attributes,
      },
    };
  });

  enrichedFindings.sort((left, right) => {
    return (
      (SEVERITY_ORDER[right.severity] ?? 0) -
      (SEVERITY_ORDER[left.severity] ?? 0)
    );
  });

  const connectorKeys = [
    ...new Set(projectFindings.map((finding) => finding.connector_key)),
  ];
  const connectorMap = new Map(
    getConnectors().map((connector) => [connector.id, connector]),
  );
  const findingSchemas: Record<string, ConnectorFindingField[]> = {};
  const presentations: Record<string, ConnectorPresentation> = {};

  for (const key of connectorKeys) {
    const connector = connectorMap.get(key);
    if (connector) {
      findingSchemas[key] = connector.getFindingSchema();

      if (resolvedPackageVersionId && connector.buildPresentation) {
        const connectorCacheId = projectFindings.find(
          (finding) => finding.connector_key === key,
        )?.connector_cache_id;
        const cacheRows = connectorCacheId
          ? await db
              .select({
                data: connector_cache.data,
                observedAt: connector_cache.queried_at,
              })
              .from(connector_cache)
              .where(eq(connector_cache.id, connectorCacheId))
              .limit(1)
          : [];

        const snapshotRows = await db
          .select()
          .from(connector_snapshots)
          .where(
            and(
              eq(connector_snapshots.project_id, projectId),
              eq(connector_snapshots.connector_key, key),
              eq(connector_snapshots.entity_type, "artifact"),
              eq(
                connector_snapshots.package_version_id,
                resolvedPackageVersionId,
              ),
            ),
          )
          .limit(1);

        if (cacheRows.length > 0 && snapshotRows.length > 0) {
          const cachedResult = cacheRows[0].data as ConnectorResult | null;
          const snapshotRow = snapshotRows[0];
          const snapshot: ConnectorSnapshot = {
            connectorKey: snapshotRow.connector_key,
            entityType: snapshotRow.entity_type,
            packageId: artifactIdentity?.package_id ?? null,
            packageVersionId: artifactIdentity?.package_version_id ?? null,
            ecosystem: artifactIdentity?.ecosystem ?? "",
            packageName: artifactIdentity?.package ?? "",
            version: artifactIdentity?.version ?? null,
            displayName: artifactIdentity?.display_name ?? "",
            fields: (snapshotRow.fields as Record<string, unknown>) ?? {},
            meta: snapshotRow.meta as ConnectorSnapshot["meta"],
            observedAt: snapshotRow.observed_at.toISOString(),
          };
          presentations[key] = connector.buildPresentation(
            cachedResult,
            snapshot,
          );
        }
      }
    }
  }

  return { findings: enrichedFindings, findingSchemas, presentations };
}
