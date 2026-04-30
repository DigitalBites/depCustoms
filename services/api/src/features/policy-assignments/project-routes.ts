import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { policy_assignments } from "../../db/schema.js";
import {
  requireProjectAccess,
  requireTenantCapability,
} from "../../http/guards.js";

export const policyAssignmentsProjectRouter = new Hono();

policyAssignmentsProjectRouter.get(
  "/v1/projects/:project_id/assignments",
  async (c) => {
    const capabilityResult = requireTenantCapability(
        c,
        "policy_assignments.read",
        "You do not have access to view project assignments",
      );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    const accessResult = await requireProjectAccess(c, {
      hideForbiddenAsNotFound: true,
    });
    if (!accessResult.ok) return accessResult.response;
    const access = accessResult.value;

    const { projectId } = access;
    const rows = await db
      .select()
      .from(policy_assignments)
      .where(eq(policy_assignments.project_id, projectId));

    return c.json({ assignments: rows });
  },
);
