import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { policy_assignments } from "../../db/schema.js";
import { getAuthContext, requireTenantCapability } from "../../http/guards.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";
import { assignmentMutationSchema } from "./shared.js";

export const policyAssignmentDetailRouter = new Hono();

async function loadAssignmentForTenant(assignmentId: string, tenantId: string) {
  const [assignment] = await db
    .select()
    .from(policy_assignments)
    .where(
      and(
        eq(policy_assignments.id, assignmentId),
        eq(policy_assignments.tenant_id, tenantId),
      ),
    )
    .limit(1);

  return assignment;
}

policyAssignmentDetailRouter.get(
  "/v1/policy-assignments/:assignment_id",
  async (c) => {
    const assignmentId = validateUuidParam(c, "assignment_id", "Assignment ID");
    if (!assignmentId) return c.res;

    const { tenantId } = getAuthContext(c);
    const assignment = await loadAssignmentForTenant(assignmentId, tenantId);
    if (!assignment) {
      return errorJson(
        c,
        404,
        "NOT_FOUND",
        "Assignment not found",
        assignmentId,
      );
    }
    if (
      !requireTenantCapability(
        c,
        "policy_assignments.read",
        "You do not have access to view this assignment",
      )
    ) {
      return c.res;
    }

    return c.json({ assignment });
  },
);

policyAssignmentDetailRouter.patch(
  "/v1/policy-assignments/:assignment_id",
  zValidator("json", assignmentMutationSchema),
  async (c) => {
    const assignmentId = validateUuidParam(c, "assignment_id", "Assignment ID");
    if (!assignmentId) return c.res;

    if (
      !requireTenantCapability(
        c,
        "policy_assignments.write",
        "You do not have access to modify policy assignments",
      )
    ) {
      return c.res;
    }

    const { tenantId } = getAuthContext(c);
    const existing = await loadAssignmentForTenant(assignmentId, tenantId);
    if (!existing) {
      return errorJson(
        c,
        404,
        "NOT_FOUND",
        "Assignment not found",
        assignmentId,
      );
    }

    const body = c.req.valid("json");
    const [updated] = await db
      .update(policy_assignments)
      .set({ ...body, updated_at: new Date() })
      .where(
        and(
          eq(policy_assignments.id, assignmentId),
          eq(policy_assignments.tenant_id, tenantId),
        ),
      )
      .returning();

    return c.json({ assignment: updated });
  },
);

policyAssignmentDetailRouter.delete(
  "/v1/policy-assignments/:assignment_id",
  async (c) => {
    const assignmentId = validateUuidParam(c, "assignment_id", "Assignment ID");
    if (!assignmentId) return c.res;

    if (
      !requireTenantCapability(
        c,
        "policy_assignments.write",
        "You do not have access to delete policy assignments",
      )
    ) {
      return c.res;
    }

    const { tenantId } = getAuthContext(c);
    const existing = await loadAssignmentForTenant(assignmentId, tenantId);
    if (!existing) {
      return errorJson(
        c,
        404,
        "NOT_FOUND",
        "Assignment not found",
        assignmentId,
      );
    }

    await db
      .delete(policy_assignments)
      .where(
        and(
          eq(policy_assignments.id, assignmentId),
          eq(policy_assignments.tenant_id, tenantId),
        ),
      );

    return c.body(null, 204);
  },
);
