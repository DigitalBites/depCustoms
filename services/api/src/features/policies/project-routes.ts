import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { policies } from "../../db/schema.js";
import {
  getAuthContext,
  requireTenantCapability,
  requireProjectAccess,
} from "../../http/guards.js";
import { loadEffectivePolicy } from "../../policy/effective.js";
import { createProjectPolicySchema } from "./shared.js";

export const projectPoliciesRouter = new Hono();

projectPoliciesRouter.get("/v1/projects/:project_id/policies", async (c) => {
  if (
    !requireTenantCapability(
      c,
      "policy.read_project",
      "You do not have access to view project policies",
    )
  ) {
    return c.res;
  }

  const access = await requireProjectAccess(c, {
    hideForbiddenAsNotFound: true,
  });
  if (!access) return c.res;

  const { projectId } = access;
  const { tenantId } = getAuthContext(c);

  const rows = await db
    .select()
    .from(policies)
    .where(
      and(
        eq(policies.tenant_id, tenantId),
        eq(policies.scope, "project"),
        eq(policies.project_id, projectId),
      ),
    )
    .orderBy(asc(policies.priority));

  return c.json({ policies: rows });
});

projectPoliciesRouter.post(
  "/v1/projects/:project_id/policies",
  zValidator("json", createProjectPolicySchema),
  async (c) => {
    if (
      !requireTenantCapability(
        c,
        "policy.write_project",
        "You do not have access to create project policies",
      )
    ) {
      return c.res;
    }

    const access = await requireProjectAccess(c, {
      hideForbiddenAsNotFound: true,
    });
    if (!access) return c.res;

    const { projectId } = access;
    const { tenantId, userId } = getAuthContext(c);
    const body = c.req.valid("json");

    const [created] = await db
      .insert(policies)
      .values({
        tenant_id: tenantId,
        project_id: projectId,
        name: body.name,
        description: body.description ?? null,
        scope: "project",
        enforcement_mode: body.enforcement_mode ?? "enforcing",
        priority: body.priority ?? 100,
        status: "active",
        created_by: userId,
      })
      .returning();

    return c.json({ policy: created }, 201);
  },
);

projectPoliciesRouter.get(
  "/v1/projects/:project_id/effective-policies",
  async (c) => {
    if (
      !requireTenantCapability(
        c,
        "policy.read_project",
        "You do not have access to view project policies",
      )
    ) {
      return c.res;
    }

    const access = await requireProjectAccess(c, {
      hideForbiddenAsNotFound: true,
    });
    if (!access) return c.res;

    const { projectId } = access;
    const { tenantId } = getAuthContext(c);
    const snapshot = await loadEffectivePolicy(db, tenantId, projectId);
    return c.json(snapshot);
  },
);
