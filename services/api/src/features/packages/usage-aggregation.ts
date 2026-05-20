import {
  DECISION,
  DISPLAY_ROLE,
  REQUEST_EVENT_SOURCE,
  REQUEST_EVENT_TYPE,
} from "@customs/shared-constants";
import type { Decision, RequestEventType } from "@customs/shared-constants";
import { inArray } from "drizzle-orm";
import type { DB } from "../../db/index.js";
import type { db } from "../../db/index.js";
import { package_versions } from "../../db/schema.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type UsageAggregationDb = Pick<DB, "select"> | Pick<Tx, "select">;

export type PackageUsageEventRow = {
  tenant_id: string;
  project_id: string | null;
  package_version_id: string | null;
  decision: Decision;
  source: string;
  event_type: RequestEventType;
  requested_ref?: string | null;
  resolved_ref?: string | null;
  requested_at?: Date;
};

export type PackageUsageDelta = {
  tenant_id: string;
  project_id: string;
  package_version_id: string;
  request_count: number;
  allow_count: number;
  block_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
};

function trimRef(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export async function buildPackageUsageDeltas(
  dbHandle: UsageAggregationDb,
  rows: PackageUsageEventRow[],
): Promise<PackageUsageDelta[]> {
  const usageRows = rows.filter(
    (row) =>
      row.project_id &&
      row.source === REQUEST_EVENT_SOURCE.PROXY &&
      (row.event_type === REQUEST_EVENT_TYPE.ARTIFACT ||
        row.event_type === REQUEST_EVENT_TYPE.UPSTREAM_ERROR),
  );
  if (usageRows.length === 0) return [];

  const packageVersionIds = [
    ...new Set(
      usageRows
        .map((row) => row.package_version_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (packageVersionIds.length === 0) return [];

  const versionRows = await dbHandle
    .select({
      id: package_versions.id,
      display_role: package_versions.display_role,
    })
    .from(package_versions)
    .where(inArray(package_versions.id, packageVersionIds));
  const displayRoleByVersionId = new Map(
    versionRows.map((row) => [row.id, row.display_role]),
  );

  const humanRefKeys = new Set<string>();
  for (const row of usageRows) {
    if (!row.project_id || !row.package_version_id) continue;
    if (
      displayRoleByVersionId.get(row.package_version_id) !==
      DISPLAY_ROLE.PRIMARY
    ) {
      continue;
    }
    const requestedRef = trimRef(row.requested_ref);
    const resolvedRef = trimRef(row.resolved_ref);
    if (requestedRef && resolvedRef && requestedRef !== resolvedRef) {
      humanRefKeys.add(`${row.project_id}|${row.package_version_id}`);
    }
  }

  const deltaMap = new Map<string, PackageUsageDelta>();
  for (const row of usageRows) {
    const packageVersionId = row.package_version_id;
    if (!packageVersionId || !row.project_id) continue;
    if (displayRoleByVersionId.get(packageVersionId) !== DISPLAY_ROLE.PRIMARY) {
      continue;
    }

    const requestedRef = trimRef(row.requested_ref);
    const resolvedRef = trimRef(row.resolved_ref);
    const key = `${row.project_id}|${packageVersionId}`;
    if (
      requestedRef &&
      resolvedRef &&
      requestedRef === resolvedRef &&
      humanRefKeys.has(key)
    ) {
      continue;
    }

    const requestedAt = row.requested_at ?? new Date();
    const isAllow = row.decision === DECISION.ALLOW;
    const existing = deltaMap.get(key);
    if (existing) {
      existing.request_count += 1;
      if (isAllow) existing.allow_count += 1;
      else existing.block_count += 1;
      if (requestedAt < existing.first_seen_at)
        existing.first_seen_at = requestedAt;
      if (requestedAt > existing.last_seen_at)
        existing.last_seen_at = requestedAt;
    } else {
      deltaMap.set(key, {
        tenant_id: row.tenant_id,
        project_id: row.project_id,
        package_version_id: packageVersionId,
        request_count: 1,
        allow_count: isAllow ? 1 : 0,
        block_count: isAllow ? 0 : 1,
        first_seen_at: requestedAt,
        last_seen_at: requestedAt,
      });
    }
  }

  return [...deltaMap.values()];
}
