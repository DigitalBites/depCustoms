import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { project_connector_syncs, project_findings } from "../../db/schema.js";
import { upsertCachedResultWithVulns } from "../../connectors/cache.js";
import type { PackageIntelligenceConnector } from "../../connectors/types.js";
import type { ProjectSyncPackage } from "./connector-sync-selection.js";

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
      const result = await connector.fetchVulns(
        pkg.ecosystem,
        pkg.name,
        pkg.version,
      );
      await upsertCachedResultWithVulns(
        db,
        connector,
        pkg.ecosystem,
        pkg.name,
        pkg.version,
        result,
      );

      if (result.findings.length === 0) continue;

      const entityId = `${pkg.ecosystem}:${pkg.name}:${pkg.version}`;
      const now = new Date();

      for (const finding of result.findings) {
        const [existing] = await db
          .select({
            id: project_findings.id,
            status: project_findings.status,
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

        if (!existing) newFindings++;

        await db
          .insert(project_findings)
          .values({
            tenant_id: tenantId,
            project_id: projectId,
            connector_key: connectorKey,
            entity_id: entityId,
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
              last_seen_at: now,
            },
          });
      }
    } catch {
      continue;
    }
  }

  const reopenResult = await db.execute(sql`
    UPDATE project_findings pf
    SET status = 'open', status_updated_at = now(), last_seen_at = now()
    FROM project_package_usage ppu
    JOIN package_versions pv ON pv.id = ppu.package_version_id
    JOIN packages p ON p.id = pv.package_id
    WHERE pf.project_id    = ${projectId}
      AND pf.tenant_id     = ${tenantId}
      AND pf.connector_key = ${connectorKey}
      AND pf.status        = 'resolved'
      AND pf.status_updated_at IS NOT NULL
      AND ppu.project_id   = ${projectId}
      AND ppu.tenant_id    = ${tenantId}
      AND p.ecosystem || ':' || p.package || ':' || pv.version = pf.entity_id
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
