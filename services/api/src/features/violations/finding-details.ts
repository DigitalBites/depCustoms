import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { connector_cache, project_findings } from "../../db/schema.js";
import { getConnectors } from "../../connectors/runtime.js";
import type { ConnectorFindingField } from "../../connectors/types.js";
import type { CacheFinding } from "../../connectors/cache.js";

function parseEntityId(entityId: string) {
  const first = entityId.indexOf(":");
  const last = entityId.lastIndexOf(":");
  if (first === -1 || first === last) return null;

  return {
    ecosystem: entityId.slice(0, first),
    packageName: entityId.slice(first + 1, last),
    version: entityId.slice(last + 1),
  };
}

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
) {
  const findings = await db
    .select()
    .from(project_findings)
    .where(
      and(
        eq(project_findings.project_id, projectId),
        eq(project_findings.tenant_id, tenantId),
        eq(project_findings.entity_id, entityId),
      ),
    );

  if (findings.length === 0) {
    return { findings: [], findingSchemas: {} };
  }

  const parsed = parseEntityId(entityId);
  const advisoryMap = new Map<
    string,
    { published_at: string | null; attributes: unknown }
  >();

  if (parsed) {
    const { ecosystem, packageName, version } = parsed;

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
        .select({ data: connector_cache.data })
        .from(connector_cache)
        .where(
          and(
            eq(connector_cache.connector_id, connectorKey),
            eq(connector_cache.ecosystem, ecosystem),
            eq(connector_cache.package, packageName),
            eq(connector_cache.version, version),
          ),
        )
        .limit(1);

      if (rows.length === 0) continue;

      const cacheFindings =
        (rows[0].data as { findings?: CacheFinding[] } | null)?.findings ?? [];
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

  for (const key of connectorKeys) {
    const connector = connectorMap.get(key);
    if (connector) {
      findingSchemas[key] = connector.getFindingSchema();
    }
  }

  return { findings: enrichedFindings, findingSchemas };
}
