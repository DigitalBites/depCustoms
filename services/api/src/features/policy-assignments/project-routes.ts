import { Hono } from "hono";
import { and, eq, gt, lte } from "drizzle-orm";
import { db } from "../../db/index.js";
import { policy_project_bindings } from "../../db/schema.js";
import {
  requireProjectAccess,
  requireTenantCapability,
} from "../../http/guards.js";

export const policyBindingsProjectRouter = new Hono();

policyBindingsProjectRouter.get(
  "/v1/projects/:project_id/bindings",
  async (c) => {
    const capabilityResult = requireTenantCapability(
        c,
        "policy_assignments.read",
        "You do not have access to view project bindings",
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
    const now = new Date();
    const rows = await db
      .select()
      .from(policy_project_bindings)
      .where(
        and(
          eq(policy_project_bindings.project_id, projectId),
          lte(policy_project_bindings.effective_from, now),
          gt(policy_project_bindings.effective_to, now),
        ),
      );

    return c.json({ bindings: rows });
  },
);
