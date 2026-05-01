import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../../db/index.js";
import { violations } from "../../../db/schema.js";
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
      entity_id: violations.entity_id,
      blocked_at: sql<Date>`max(${violations.last_seen_at})`,
      reason_summary: violations.message,
      matched_rule: violations.rule_name,
      reason_code: violations.code,
    })
    .from(violations)
    .where(
      and(
        eq(violations.project_id, projectId),
        eq(violations.tenant_id, ctx.principal.tenantId),
        eq(violations.blocked, true),
      ),
    )
    .groupBy(
      violations.entity_id,
      violations.message,
      violations.rule_name,
      violations.code,
    )
    .orderBy(desc(sql`max(${violations.last_seen_at})`))
    .limit(limit);

  return {
    tenant_id: ctx.principal.tenantId,
    project_id: projectId,
    items: rows.map((row) => {
      const [ecosystem, packageName, version] = row.entity_id.split(":");
      return {
        ecosystem,
        package: packageName,
        version,
        blocked_at: toIsoTimestamp(row.blocked_at),
        reason_code: row.reason_code,
        reason_summary: row.reason_summary,
        matched_rule: row.matched_rule,
      };
    }),
  };
}
