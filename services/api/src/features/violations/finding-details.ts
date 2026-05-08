import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { connector_cache, connector_snapshots, project_findings } from "../../db/schema.js";
import { getConnectors } from "../../connectors/runtime.js";
import type {
  ConnectorFindingField,
  ConnectorPresentation,
  ConnectorResult,
  ConnectorSnapshot,
} from "../../connectors/types.js";
import type { CacheFinding } from "../../connectors/cache.js";

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
  entityId: string,
  packageVersionId: string | null = null,
) {
  if (!packageVersionId) {
    return { findings: [], findingSchemas: {}, presentations: {} };
  }

  const findings = await db
    .select()
    .from(project_findings)
    .where(
      and(
        eq(project_findings.project_id, projectId),
        eq(project_findings.tenant_id, tenantId),
        eq(project_findings.package_version_id, packageVersionId),
      ),
    );

  if (findings.length === 0) {
    return { findings: [], findingSchemas: {}, presentations: {} };
  }

  const resolvedPackageVersionId = packageVersionId;
  const advisoryMap = new Map<
    string,
    { published_at: string | null; attributes: unknown }
  >();

  if (resolvedPackageVersionId) {
    // Group finding IDs by connector key
    const findingsByConnector = new Map<string, Set<string>>();
    for (const finding of findings) {
      const ids = findingsByConnector.get(finding.connector_key) ?? new Set();
      ids.add(finding.finding_id);
      findingsByConnector.set(finding.connector_key, ids);
    }

    // Read connector_cache.data for each connector and extract matching findings
    for (const [connectorKey, findingIds] of findingsByConnector) {
      const rows = await db
        .select({ data: connector_cache.data, observedAt: connector_cache.queried_at })
        .from(connector_cache)
        .where(
          and(
            eq(connector_cache.connector_id, connectorKey),
            eq(connector_cache.package_version_id, resolvedPackageVersionId),
          ),
        )
        .limit(1);

      if (rows.length === 0) continue;

      const cacheData = rows[0].data as ConnectorResult | null;
      const cacheFindings =
        (cacheData as { findings?: CacheFinding[] } | null)?.findings ?? [];
      for (const f of cacheFindings) {
        if (findingIds.has(f.id)) {
          advisoryMap.set(f.id, {
            published_at: f.published_at,
            attributes: f.attributes,
          });
        }
      }
    }
  }

  const enrichedFindings = findings.map((finding) => {
    const advisory = advisoryMap.get(finding.finding_id);
    return {
      ...finding,
      advisory: advisory
        ? {
            published_at: advisory.published_at ?? null,
            attributes: advisory.attributes,
          }
        : null,
    };
  });

  enrichedFindings.sort((left, right) => {
    if (left.status !== right.status) return left.status === "open" ? -1 : 1;
    return (
      (SEVERITY_ORDER[right.severity] ?? 0) -
      (SEVERITY_ORDER[left.severity] ?? 0)
    );
  });

  const connectorKeys = [
    ...new Set(findings.map((finding) => finding.connector_key)),
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
        const cacheRows = await db
          .select({ data: connector_cache.data, observedAt: connector_cache.queried_at })
          .from(connector_cache)
          .where(
            and(
              eq(connector_cache.connector_id, key),
              eq(connector_cache.package_version_id, resolvedPackageVersionId),
            ),
          )
          .limit(1);

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
            entityId,
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
