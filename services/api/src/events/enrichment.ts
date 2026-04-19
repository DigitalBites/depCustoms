import { and, eq, inArray, sql } from "drizzle-orm";
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

  const keys = [
    ...new Map(
      cveRows.map((row) => [
        `${row.ecosystem}|${row.package}|${row.version}`,
        row,
      ]),
    ).values(),
  ];

  const cacheRows = await db
    .select({
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
        inArray(
          sql`(${connector_cache.ecosystem} || '|' || ${connector_cache.package} || '|' || ${connector_cache.version})`,
          keys.map((row) => `${row.ecosystem}|${row.package}|${row.version}`),
        ),
      ),
    );

  const cacheMap = new Map(
    cacheRows.map((row) => [
      `${row.ecosystem}|${row.package}|${row.version}`,
      row,
    ]),
  );

  return rows.map((row) => {
    if (row.reason !== "cve_threshold") {
      return { ...row, cve_severity: null, fix_version: null };
    }

    const cached = cacheMap.get(
      `${row.ecosystem}|${row.package}|${row.version}`,
    );
    return {
      ...row,
      cve_severity: cached?.max_severity ?? null,
      fix_version: cached?.best_fix_version ?? null,
    };
  });
}
