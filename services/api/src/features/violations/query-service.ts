import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { db } from "../../db/index.js";
import { violation_suppressions, violations } from "../../db/schema.js";

export type ViolationListFilters = {
  status?: string;
  severity?: string;
  since?: Date;
  until?: Date;
  entityId?: string;
  search?: string;
  ruleId?: string;
  policyId?: string;
  limit: number;
  offset: number;
};

type ViolationScope = {
  tenantId: string;
  projectId?: string;
  allowedProjectIds?: string[] | null;
};

function buildViolationScope(scope: ViolationScope) {
  if (scope.projectId) {
    return and(
      eq(violations.project_id, scope.projectId),
      eq(violations.tenant_id, scope.tenantId),
    );
  }

  return and(
    eq(violations.tenant_id, scope.tenantId),
    scope.allowedProjectIds === undefined || scope.allowedProjectIds === null
      ? undefined
      : scope.allowedProjectIds.length > 0
        ? inArray(violations.project_id, scope.allowedProjectIds)
        : sql`false`,
  );
}

function buildSuppressionScope(scope: ViolationScope) {
  if (scope.projectId) {
    return and(
      eq(violation_suppressions.tenant_id, scope.tenantId),
      or(
        eq(violation_suppressions.project_id, scope.projectId),
        isNull(violation_suppressions.project_id),
      ),
    );
  }

  return and(
    eq(violation_suppressions.tenant_id, scope.tenantId),
    scope.allowedProjectIds === undefined || scope.allowedProjectIds === null
      ? undefined
      : scope.allowedProjectIds.length > 0
        ? or(
            isNull(violation_suppressions.project_id),
            inArray(violation_suppressions.project_id, scope.allowedProjectIds),
          )
        : isNull(violation_suppressions.project_id),
  );
}

export async function loadViolationSummary(scope: ViolationScope) {
  const now = new Date();
  const week1Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const week2Start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const violationScope = buildViolationScope(scope);
  const openScope = and(violationScope, eq(violations.status, "open"));
  const suppressionScope = buildSuppressionScope(scope);

  const [
    statusRows,
    severityRows,
    blockedRows,
    thisWeekRow,
    priorWeekRow,
    suppressionRow,
  ] = await Promise.all([
    db
      .select({ status: violations.status, count: sql<string>`count(*)` })
      .from(violations)
      .where(violationScope)
      .groupBy(violations.status),
    db
      .select({ severity: violations.severity, count: sql<string>`count(*)` })
      .from(violations)
      .where(openScope)
      .groupBy(violations.severity),
    db
      .select({ blocked: violations.blocked, count: sql<string>`count(*)` })
      .from(violations)
      .where(openScope)
      .groupBy(violations.blocked),
    db
      .select({ count: sql<string>`count(*)` })
      .from(violations)
      .where(and(violationScope, gte(violations.last_seen_at, week1Start))),
    db
      .select({ count: sql<string>`count(*)` })
      .from(violations)
      .where(
        and(
          violationScope,
          gte(violations.last_seen_at, week2Start),
          lte(violations.last_seen_at, week1Start),
        ),
      ),
    db
      .select({ count: sql<string>`count(*)` })
      .from(violation_suppressions)
      .where(suppressionScope),
  ]);

  return {
    now,
    statusRows,
    severityRows,
    blockedRows,
    thisWeekRow,
    priorWeekRow,
    suppressionRow,
  };
}

export async function listViolations(
  scope: ViolationScope,
  filters: ViolationListFilters,
) {
  const conditions = [buildViolationScope(scope)];

  if (filters.status) conditions.push(eq(violations.status, filters.status));
  if (filters.severity)
    conditions.push(eq(violations.severity, filters.severity));
  if (filters.since)
    conditions.push(gte(violations.last_seen_at, filters.since));
  if (filters.until)
    conditions.push(lte(violations.last_seen_at, filters.until));
  if (filters.entityId)
    conditions.push(eq(violations.entity_id, filters.entityId));
  if (filters.search)
    conditions.push(ilike(violations.entity_id, `%${filters.search}%`));
  if (filters.ruleId) conditions.push(eq(violations.rule_id, filters.ruleId));
  if (filters.policyId)
    conditions.push(eq(violations.policy_id, filters.policyId));

  return db
    .select()
    .from(violations)
    .where(
      and(
        ...(conditions as [ReturnType<typeof and>, ...ReturnType<typeof eq>[]]),
      ),
    )
    .orderBy(desc(violations.last_seen_at))
    .limit(filters.limit)
    .offset(filters.offset);
}
