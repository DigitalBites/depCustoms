import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { events } from "../../db/schema.js";
import { enrichEventCveFields } from "../../events/enrichment.js";
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
  if (input.ecosystem) conditions.push(eq(events.ecosystem, input.ecosystem));
  if (input.decision) conditions.push(eq(events.decision, input.decision));
  if (input.since) conditions.push(gte(events.requested_at, input.since));

  const whereClause = and(
    ...(conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]]),
  );

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(events)
      .where(whereClause)
      .orderBy(desc(events.requested_at))
      .limit(input.limit)
      .offset(input.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(events)
      .where(whereClause),
  ]);

  const enriched = await enrichEventCveFields(rows);
  return { events: enriched, total: count };
}
