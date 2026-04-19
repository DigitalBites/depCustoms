/**
 * Field resolver — builds the flat field map used by the expression engine
 * for a single policy evaluation request.
 *
 * Resolution order:
 *   1. source.<connector_key>._meta.<field_key>  — from snapshot.meta
 *   2. source.<connector_key>.<field_key>        — from snapshot.fields
 *   3. asset.<field_key>                         — from request context
 *   4. project.<field_key>                       — from project metadata (future)
 *   5. runtime.<field_key>                       — timestamp etc. (future)
 *
 * On failure (no snapshot, or snapshot.fields is empty), data fields resolve
 * to null.  _meta fields always resolve because snapshots are always written.
 */

import type { ConnectorSnapshot } from "../connectors/types.js";

export interface AssetContext {
  ecosystem: string;
  pkg: string;
  version: string;
}

/**
 * Build the flat field map for a single evaluation.
 *
 * @param snapshots  - connector snapshots for this entity (one per connector)
 * @param asset      - the package being evaluated
 */
export function resolveFields(
  snapshots: ConnectorSnapshot[],
  asset: AssetContext,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  // Asset built-ins
  fields["asset.ecosystem"] = asset.ecosystem;
  fields["asset.package"] = asset.pkg;
  fields["asset.version"] = asset.version;

  // Runtime built-ins
  fields["runtime.request_timestamp"] = new Date().toISOString();

  // Connector fields
  for (const snapshot of snapshots) {
    const key = snapshot.connectorKey;

    // _meta fields — always populated
    fields[`source.${key}._meta.status`] = snapshot.meta.status;
    fields[`source.${key}._meta.response_time_ms`] =
      snapshot.meta.responseTimeMs;
    fields[`source.${key}._meta.cache_age_hours`] = snapshot.meta.cacheAgeHours;
    fields[`source.${key}._meta.is_cache_hit`] = snapshot.meta.isCacheHit;
    if (snapshot.meta.errorCode !== undefined) {
      fields[`source.${key}._meta.error_code`] = snapshot.meta.errorCode;
    }

    // Data fields — null when connector failed (fields is {})
    for (const [fieldKey, value] of Object.entries(snapshot.fields)) {
      fields[`source.${key}.${fieldKey}`] = value;
    }
  }

  return fields;
}

/**
 * Build an "unavailable" field map for a connector that has no snapshot.
 * This is used when no snapshot exists at all (first-ever request).
 * The meta status is set to 'unavailable' so availability rules fire.
 */
export function unavailableSnapshot(connectorKey: string): ConnectorSnapshot {
  return {
    connectorKey,
    entityType: "artifact",
    entityId: "",
    fields: {},
    meta: {
      status: "unavailable",
      responseTimeMs: 0,
      cacheAgeHours: null,
      isCacheHit: false,
    },
    observedAt: new Date().toISOString(),
  };
}
