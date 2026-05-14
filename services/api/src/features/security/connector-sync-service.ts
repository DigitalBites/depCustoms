import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { project_connector_syncs } from "../../db/schema.js";
import { upsertCachedResultWithFindings } from "../../connectors/cache.js";
import type { PackageIntelligenceConnector } from "../../connectors/types.js";
import {
  buildArtifactRequestEvent,
  connectorSupportsEvent,
} from "../../connectors/events.js";
import type { ProjectSyncPackage } from "./connector-sync-selection.js";
import { upsertProjectFindingsForEntity } from "./project-findings.js";

const SYNC_COOLDOWN_MS = 15 * 60 * 1000;

export async function loadConnectorSyncCooldown(
  projectId: string,
  connectorKey: string,
) {
  const [syncRecord] = await db
    .select()
    .from(project_connector_syncs)
    .where(
      and(
        eq(project_connector_syncs.project_id, projectId),
        eq(project_connector_syncs.connector_key, connectorKey),
      ),
    )
    .limit(1);

  if (!syncRecord) {
    return null;
  }

  const elapsed = Date.now() - syncRecord.last_synced_at.getTime();
  if (elapsed >= SYNC_COOLDOWN_MS) {
    return null;
  }

  return Math.ceil((SYNC_COOLDOWN_MS - elapsed) / 1000);
}

export async function runProjectConnectorSync(input: {
  tenantId: string;
  projectId: string;
  connectorKey: string;
  connector: PackageIntelligenceConnector;
  packagesToSync: ProjectSyncPackage[];
}) {
  const { tenantId, projectId, connectorKey, connector, packagesToSync } =
    input;
  if (packagesToSync.length === 0) {
    return { synced: 0, newFindings: 0, reopened: 0, durationMs: 0 };
  }

  const startMs = Date.now();
  let newFindings = 0;

  for (const pkg of packagesToSync) {
    try {
      const event = buildArtifactRequestEvent({
        artifactIdentity: {
          package_id: pkg.packageId,
          package_version_id: pkg.packageVersionId,
          ecosystem: pkg.ecosystem,
          package: pkg.name,
          version: pkg.version,
        },
        source: "sync",
        context: {
          tenantId,
          projectId,
        },
      });
      if (!connectorSupportsEvent(connector, event)) {
        continue;
      }
      const result = await connector.handleEvent(event);
      if (!result) {
        continue;
      }
      const cacheRow = await upsertCachedResultWithFindings(
        db,
        connector,
        event,
        result,
      );

      if (result.findings.length === 0) continue;

      const findingWrite = await upsertProjectFindingsForEntity(db, {
        tenantId,
        projectId,
        connectorKey,
        connectorCacheId: cacheRow?.id ?? null,
        packageId: pkg.packageId,
        packageVersionId: pkg.packageVersionId,
        findings: result.findings,
      });
      newFindings += findingWrite.newFindings;
    } catch {
      continue;
    }
  }

  const reopened = 0;
  const durationMs = Date.now() - startMs;
  const synced = packagesToSync.length;
  const lastSyncedAt = new Date();

  await db
    .insert(project_connector_syncs)
    .values({
      project_id: projectId,
      connector_key: connectorKey,
      last_synced_at: lastSyncedAt,
      synced_count: synced,
      new_findings: newFindings,
      reopened_count: reopened,
      duration_ms: durationMs,
    })
    .onConflictDoUpdate({
      target: [
        project_connector_syncs.project_id,
        project_connector_syncs.connector_key,
      ],
      set: {
        last_synced_at: lastSyncedAt,
        synced_count: synced,
        new_findings: newFindings,
        reopened_count: reopened,
        duration_ms: durationMs,
      },
    });

  return {
    synced,
    newFindings,
    reopened,
    durationMs,
  };
}
