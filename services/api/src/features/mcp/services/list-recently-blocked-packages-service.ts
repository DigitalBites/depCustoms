import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../../db/index.js";
import { packages, package_versions, violations } from "../../../db/schema.js";
import type { McpRequestContext } from "../context.js";
import { requireMcpProjectAccess } from "./project-access.js";

function toIsoTimestamp(value: Date | string): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  return timestamp.toISOString();
}

export async function listRecentlyBlockedPackagesForMcp(
  ctx: McpRequestContext,
  projectId: string,
  limit: number,
) {
  await requireMcpProjectAccess(ctx.principal, projectId);

  const rows = await db
    .select({
      ecosystem: packages.ecosystem,
      package: packages.package,
      version: package_versions.version,
      blocked_at: sql<Date>`max(${violations.last_seen_at})`,
      reason_summary: violations.message,
      matched_rule: sql<string>`''`,
      reason_code: violations.code,
    })
    .from(violations)
    .innerJoin(
      package_versions,
      eq(violations.package_version_id, package_versions.id),
    )
    .innerJoin(packages, eq(package_versions.package_id, packages.id))
    .where(
      and(
        eq(violations.project_id, projectId),
        eq(violations.tenant_id, ctx.principal.tenantId),
        eq(violations.blocked, true),
      ),
    )
    .groupBy(
      packages.ecosystem,
      packages.package,
      package_versions.version,
      violations.message,
      violations.code,
    )
    .orderBy(desc(sql`max(${violations.last_seen_at})`))
    .limit(limit);

  return {
    tenant_id: ctx.principal.tenantId,
    project_id: projectId,
    items: rows.map((row) => {
      return {
        ecosystem: row.ecosystem,
        package: row.package,
        version: row.version,
        blocked_at: toIsoTimestamp(row.blocked_at),
        reason_code: row.reason_code,
        reason_summary: row.reason_summary,
        matched_rule: row.matched_rule,
      };
    }),
  };
}
