import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import type { events } from "../db/schema.js";
import { connector_cache } from "../db/schema.js";

export type EventRow = typeof events.$inferSelect;
export type EnrichedEventRow = EventRow & {
  cve_severity: string | null;
  fix_version: string | null;
};

export async function enrichEventCveFields(
  rows: EventRow[],
): Promise<EnrichedEventRow[]> {
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
  const legacyKeys = [
    ...new Map(
      cveRows
        .filter((row) => !row.package_version_id)
        .map((row) => [
          `${row.ecosystem}|${row.package}|${row.version}`,
          row,
        ]),
    ).values(),
  ];

  const identityConditions = [
    packageVersionIds.length > 0
      ? inArray(connector_cache.package_version_id, packageVersionIds)
      : undefined,
    legacyKeys.length > 0
      ? inArray(
          sql`(${connector_cache.ecosystem} || '|' || ${connector_cache.package} || '|' || ${connector_cache.version})`,
          legacyKeys.map(
            (row) => `${row.ecosystem}|${row.package}|${row.version}`,
          ),
        )
      : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> =>
    Boolean(condition),
  );

  const cacheRows = await db
    .select({
      package_version_id: connector_cache.package_version_id,
      ecosystem: connector_cache.ecosystem,
      package: connector_cache.package,
      version: connector_cache.version,
      max_severity: connector_cache.max_severity,
      best_fix_version: connector_cache.best_fix_version,
    })
    .from(connector_cache)
    .where(
      and(
        eq(connector_cache.connector_id, "osv"),
        identityConditions.length === 1
          ? identityConditions[0]
          : or(...identityConditions),
      ),
    );

  const cacheByPackageVersionId = new Map(
    cacheRows
      .filter((row) => row.package_version_id)
      .map((row) => [row.package_version_id, row]),
  );
  const legacyCacheMap = new Map(
    cacheRows
      .filter((row) => !row.package_version_id)
      .map((row) => [
        `${row.ecosystem}|${row.package}|${row.version}`,
        row,
      ]),
  );

  return rows.map((row) => {
    if (row.reason !== "cve_threshold") {
      return { ...row, cve_severity: null, fix_version: null };
    }

    const cached =
      (row.package_version_id
        ? cacheByPackageVersionId.get(row.package_version_id)
        : undefined) ??
      legacyCacheMap.get(`${row.ecosystem}|${row.package}|${row.version}`);
    return {
      ...row,
      cve_severity: cached?.max_severity ?? null,
      fix_version: cached?.best_fix_version ?? null,
    };
  });
}
