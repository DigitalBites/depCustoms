import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { project_connector_syncs } from "../../db/schema.js";
import { upsertCachedResultWithFindings } from "../../connectors/cache.js";
import type { PackageIntelligenceConnector } from "../../connectors/types.js";
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
      const result = await connector.fetchSignals(
        pkg.ecosystem,
        pkg.name,
        pkg.version,
        {
          tenantId,
          projectId,
        },
      );
      await upsertCachedResultWithFindings(
        db,
        connector,
        pkg.ecosystem,
        pkg.name,
        pkg.version,
        result,
      );

      if (result.findings.length === 0) continue;

      const entityId = `${pkg.ecosystem}:${pkg.name}:${pkg.version}`;
      const findingWrite = await upsertProjectFindingsForEntity(db, {
        tenantId,
        projectId,
        connectorKey,
        entityId,
        findings: result.findings,
      });
      newFindings += findingWrite.newFindings;
    } catch {
      continue;
    }
  }

  const reopenResult = await db.execute(sql`
    UPDATE project_findings pf
    SET status = 'open', status_updated_at = now(), last_seen_at = now()
    FROM project_package_usage ppu
    JOIN package_versions pv ON pv.id = ppu.package_version_id
    WHERE pf.project_id    = ${projectId}
      AND pf.tenant_id     = ${tenantId}
      AND pf.connector_key = ${connectorKey}
      AND pf.status        = 'resolved'
      AND pf.status_updated_at IS NOT NULL
      AND ppu.project_id   = ${projectId}
      AND ppu.tenant_id    = ${tenantId}
      AND pf.package_version_id = pv.id
      AND ppu.updated_at   > pf.status_updated_at
  `);
  const reopened = Number(
    (reopenResult as { rowCount?: number }).rowCount ?? 0,
  );
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
