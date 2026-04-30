/**
 * Connector registry — instantiates, initializes, and registers connectors.
 *
 * On every startup, after connectors are initialized, `registerAllFields()` upserts
 * each connector's declared field catalog into connector_fields and marks any fields
 * that were removed from the code as deprecated (not deleted — existing rules may
 * still reference them).
 *
 * All config values are read once at startup and are not hot-reloaded.
 * A restart is required to pick up env var changes.
 */

import { sql, and, notInArray, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PackageIntelligenceConnector } from "./types.js";
import { OsvConnector } from "./osv/index.js";
import { OsvConnectorConfig } from "./osv/config.js";
import { ContributorConnector } from "./contributor/index.js";
import { ContributorConnectorConfig } from "./contributor/config.js";
import { IntelligenceConnector } from "./intelligence/index.js";
import { IntelligenceConnectorConfig } from "./intelligence/config.js";
import { connector_fields } from "../db/schema.js";
import { log } from "../logger.js";

export function buildConnectors(): PackageIntelligenceConnector[] {
  const connectors: PackageIntelligenceConnector[] = [];

  const osvConfig = new OsvConnectorConfig();
  osvConfig.logStartup();
  if (osvConfig.enabled) {
    connectors.push(new OsvConnector(osvConfig));
  }

  const contributorConfig = new ContributorConnectorConfig();
  contributorConfig.logStartup();
  if (contributorConfig.enabled) {
    connectors.push(new ContributorConnector(contributorConfig));
  }

  const intelligenceConfig = new IntelligenceConnectorConfig();
  intelligenceConfig.logStartup();
  if (intelligenceConfig.enabled) {
    connectors.push(new IntelligenceConnector(intelligenceConfig));
  }

  return connectors;
}

// ---------------------------------------------------------------------------
// Field catalog registration — called once on startup after db is ready
// ---------------------------------------------------------------------------

export async function registerAllFields(
  db: NodePgDatabase<any>,
  connectors: PackageIntelligenceConnector[],
): Promise<void> {
  for (const connector of connectors) {
    const fields = connector.getFieldCatalog();
    if (fields.length === 0) continue;

    await db
      .insert(connector_fields)
      .values(
        fields.map((f) => ({
          connector_key: f.connectorKey,
          field_key: f.fieldKey,
          canonical_ref: f.canonicalRef,
          label: f.label,
          description: f.description ?? null,
          data_type: f.dataType,
          entity_type: f.entityType,
          operators: f.operators,
          enum_values: f.enumValues ? (f.enumValues as unknown[]) : null,
          deprecated: false,
        })),
      )
      .onConflictDoUpdate({
        target: connector_fields.canonical_ref,
        set: {
          label: sql`EXCLUDED.label`,
          description: sql`EXCLUDED.description`,
          operators: sql`EXCLUDED.operators`,
          enum_values: sql`EXCLUDED.enum_values`,
          deprecated: false,
          updated_at: sql`now()`,
        },
      });

    log.info("connector_fields_registered", {
      connector_key: connector.id,
      field_count: fields.length,
    });
  }

  await deprecateRemovedFields(db, connectors);
}

async function deprecateRemovedFields(
  db: NodePgDatabase<any>,
  connectors: PackageIntelligenceConnector[],
): Promise<void> {
  const activeCatalogRefs = connectors
    .flatMap((c) => c.getFieldCatalog())
    .map((f) => f.canonicalRef);
  if (activeCatalogRefs.length === 0) return;

  const result = await db
    .update(connector_fields)
    .set({ deprecated: true, updated_at: sql`now()` })
    .where(
      and(
        notInArray(connector_fields.canonical_ref, activeCatalogRefs),
        eq(connector_fields.deprecated, false),
      ),
    )
    .returning({ canonical_ref: connector_fields.canonical_ref });

  if (result.length > 0) {
    log.warn("connector_fields_deprecated", {
      deprecated_count: result.length,
      refs: result.map((r) => r.canonical_ref),
    });
  }
}
