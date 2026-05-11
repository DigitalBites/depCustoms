import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { connector_cache } from "../db/schema.js";

export type EventRow = {
  package_version_id: string | null;
  reason: string | null;
};
export type EnrichedEventRow = EventRow & {
  cve_severity: string | null;
  fix_version: string | null;
};

export async function enrichEventCveFields<T extends EventRow>(
  rows: T[],
): Promise<Array<T & EnrichedEventRow>> {
  const cveRows = rows.filter((row) => row.reason === "cve_threshold");
  if (cveRows.length === 0) {
    return rows.map((row) => ({
      ...row,
      cve_severity: null,
      fix_version: null,
    }));
  }

  const packageVersionIds = [
    ...new Set(
      cveRows
        .map((row) => row.package_version_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (packageVersionIds.length === 0) {
    return rows.map((row) => ({
      ...row,
      cve_severity: null,
      fix_version: null,
    }));
  }

  const cacheRows = await db
    .select({
      package_version_id: connector_cache.package_version_id,
      risk_tier: connector_cache.risk_tier,
      best_remediation: connector_cache.best_remediation,
    })
    .from(connector_cache)
    .where(
      and(
        eq(connector_cache.connector_id, "osv"),
        inArray(connector_cache.package_version_id, packageVersionIds),
      ),
    );

  const cacheByPackageVersionId = new Map(
    cacheRows
      .filter((row) => row.package_version_id)
      .map((row) => [row.package_version_id, row]),
  );

  return rows.map((row) => {
    if (row.reason !== "cve_threshold") {
      return { ...row, cve_severity: null, fix_version: null };
    }

    const cached = row.package_version_id
      ? cacheByPackageVersionId.get(row.package_version_id)
      : undefined;
    return {
      ...row,
      cve_severity: cached?.risk_tier ?? null,
      fix_version: cached?.best_remediation ?? null,
    };
  });
}
