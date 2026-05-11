import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  events,
  packages,
  package_versions,
  project_members,
} from "../../db/schema.js";
import { enrichEventCveFields } from "../../events/enrichment.js";
import { getAuthContext } from "../../http/guards.js";
import { canPerform, isTenantRole } from "../../middleware/rbac.js";
import { eventSelectFields } from "../events/shared.js";
import { formatSSEEvent, rowToPayload } from "./stream-format.js";
import type { Context } from "hono";

export async function resolveAllowedProjects(c: Context) {
  const { tenantId, userId, role } = getAuthContext(c);
  const hasTenantEventAccess =
    isTenantRole(role) && canPerform(role, "events.read_tenant");

  if (hasTenantEventAccess) {
    return {
      tenantId,
      role,
      hasTenantEventAccess,
      allowedProjects: null as Set<string> | null,
    };
  }

  const memberRows = await db
    .select({ project_id: project_members.project_id })
    .from(project_members)
    .where(
      and(
        eq(project_members.user_id, userId),
        eq(project_members.tenant_id, tenantId),
      ),
    );

  return {
    tenantId,
    role,
    hasTenantEventAccess,
    allowedProjects: new Set(memberRows.map((row) => row.project_id)),
  };
}

export async function replayMissedEvents(input: {
  tenantId: string;
  role: string;
  hasTenantEventAccess: boolean;
  projectFilter: string | null;
  allowedProjects: Set<string> | null;
  lastEventId: string | null;
  write: (chunk: string) => void;
}): Promise<void> {
  const {
    tenantId,
    role,
    hasTenantEventAccess,
    projectFilter,
    allowedProjects,
    lastEventId,
    write,
  } = input;

  const memberWithNoProjects =
    !hasTenantEventAccess &&
    allowedProjects !== null &&
    allowedProjects.size === 0;

  if (!lastEventId || memberWithNoProjects) {
    return;
  }

  try {
    const cursor = new Date(lastEventId);
    if (Number.isNaN(cursor.getTime())) {
      return;
    }

    const conditions = [
      eq(events.tenant_id, tenantId),
      gt(events.created_at, cursor),
    ];
    if (projectFilter) {
      conditions.push(eq(events.project_id, projectFilter));
    } else if (!hasTenantEventAccess && allowedProjects) {
      conditions.push(inArray(events.project_id, [...allowedProjects]));
    }

    const missed = await db
      .select(eventSelectFields)
      .from(events)
      .leftJoin(packages, eq(packages.id, events.package_id))
      .leftJoin(
        package_versions,
        eq(package_versions.id, events.package_version_id),
      )
      .where(and(...conditions))
      .orderBy(asc(events.created_at))
      .limit(100);

    const enriched = await enrichEventCveFields(missed);
    for (const row of enriched) {
      write(formatSSEEvent(rowToPayload(row)));
    }
  } catch {
    void role;
  }
}
