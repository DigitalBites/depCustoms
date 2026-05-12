import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { events, packages, package_versions } from "../../db/schema.js";
import { enrichEventCveFields } from "../../events/enrichment.js";
import { canonicalizeEcosystem } from "../packages/identity.js";
import {
  isoDatetimeQuerySchema,
  optionalStringQuerySchema,
  paginationQuerySchema,
} from "../../http/validation.js";

export const tenantEventsQuerySchema = paginationQuerySchema(100, 200).extend({
  project_id: optionalStringQuerySchema,
  ecosystem: optionalStringQuerySchema,
  decision: optionalStringQuerySchema,
  since: isoDatetimeQuerySchema.optional(),
});

export const projectEventsQuerySchema = paginationQuerySchema(50, 200).extend({
  ecosystem: optionalStringQuerySchema,
  decision: optionalStringQuerySchema,
  since: isoDatetimeQuerySchema.optional(),
});

export async function listEventsWithCount(input: {
  projectId?: string;
  tenantId?: string;
  allowedProjectIds?: string[] | null;
  ecosystem?: string;
  decision?: string;
  since?: Date;
  limit: number;
  offset: number;
}) {
  const conditions = [];

  if (input.tenantId) conditions.push(eq(events.tenant_id, input.tenantId));
  if (input.projectId) {
    conditions.push(eq(events.project_id, input.projectId));
  } else if (
    input.allowedProjectIds !== undefined &&
    input.allowedProjectIds !== null
  ) {
    conditions.push(inArray(events.project_id, input.allowedProjectIds));
  }
  if (input.ecosystem) {
    const ecosystem = canonicalizeEcosystem(input.ecosystem);
    conditions.push(
      sql`lower(btrim(COALESCE(${packages.ecosystem}, ${events.raw_identity}->>'ecosystem'))) = ${ecosystem}`,
    );
  }
  if (input.decision) conditions.push(eq(events.decision, input.decision));
  if (input.since) conditions.push(gte(events.requested_at, input.since));

  const whereClause = and(
    ...(conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]]),
  );

  const [rows, [{ count }]] = await Promise.all([
    db
      .select(eventSelectFields)
      .from(events)
      .leftJoin(packages, eq(packages.id, events.package_id))
      .leftJoin(
        package_versions,
        eq(package_versions.id, events.package_version_id),
      )
      .where(whereClause)
      .orderBy(desc(events.requested_at))
      .limit(input.limit)
      .offset(input.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(events)
      .leftJoin(packages, eq(packages.id, events.package_id))
      .where(whereClause),
  ]);

  const enriched = await enrichEventCveFields(rows);
  return { events: enriched, total: count };
}

export const eventSelectFields = {
  id: events.id,
  tenant_id: events.tenant_id,
  project_id: events.project_id,
  proxy_id: events.proxy_id,
  ecosystem: sql<string>`COALESCE(${packages.ecosystem}, ${events.raw_identity}->>'ecosystem', '')`,
  package: sql<string>`COALESCE(${packages.package}, ${events.raw_identity}->>'package', '')`,
  version: sql<string>`COALESCE(${package_versions.version}, ${events.raw_identity}->>'version', '')`,
  package_id: events.package_id,
  package_version_id: events.package_version_id,
  decision: events.decision,
  reason: events.reason,
  source: events.source,
  event_type: events.event_type,
  decision_cache: events.decision_cache,
  trace_id: events.trace_id,
  span_id: events.span_id,
  request_id: events.request_id,
  serve_mode: events.serve_mode,
  bytes_transferred: events.bytes_transferred,
  project_token_id: events.project_token_id,
  client_ip: events.client_ip,
  proxy_ip: events.proxy_ip,
  duration_ms: events.duration_ms,
  decision_path: events.decision_path,
  raw_identity: events.raw_identity,
  requested_at: events.requested_at,
  created_at: events.created_at,
};
