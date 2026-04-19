import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { violations } from "../../db/schema.js";
import {
  getAuthContext,
  requireTenantCapability,
  requireResolvedProjectAccess,
} from "../../http/guards.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";
import { enrichViolations } from "./enrichment.js";
import { loadViolationFindings } from "./finding-details.js";
import {
  applyBulkViolationStatusUpdate,
  applyViolationStatusUpdate,
  bulkViolationStatusUpdateSchema,
  violationStatusUpdateSchema,
} from "./project-shared.js";

export const projectViolationDetailRouter = new Hono();

projectViolationDetailRouter.get("/v1/violations/:violation_id", async (c) => {
  const violationId = validateUuidParam(c, "violation_id", "Violation ID");
  if (!violationId) return c.res;

  if (!requireTenantCapability(c, "violations.read_project", "Access denied")) {
    return c.res;
  }

  const { tenantId } = getAuthContext(c);
  const [violation] = await db
    .select()
    .from(violations)
    .where(
      and(eq(violations.id, violationId), eq(violations.tenant_id, tenantId)),
    )
    .limit(1);

  if (!violation) {
    return errorJson(c, 404, "NOT_FOUND", "Violation not found", violationId);
  }

  const access = await requireResolvedProjectAccess(c, violation.project_id);
  if (!access) return c.res;

  const [[enriched], { findings, findingSchemas }] = await Promise.all([
    enrichViolations([violation]),
    loadViolationFindings(violation.project_id, tenantId, violation.entity_id),
  ]);

  return c.json({ violation: { ...enriched, findings, findingSchemas } });
});

projectViolationDetailRouter.patch(
  "/v1/violations/bulk-status",
  zValidator("json", bulkViolationStatusUpdateSchema),
  async (c) => {
    if (!requireTenantCapability(c, "violations.write", "Access denied"))
      return c.res;

    const { tenantId, userId } = getAuthContext(c);
    const body = c.req.valid("json");

    const result = await applyBulkViolationStatusUpdate(
      body.violation_ids,
      tenantId,
      userId,
      body,
    );

    return c.json({
      updated_count: result.updatedIds.length,
      updated_ids: result.updatedIds,
    });
  },
);

projectViolationDetailRouter.patch(
  "/v1/violations/:violation_id/status",
  zValidator("json", violationStatusUpdateSchema),
  async (c) => {
    const violationId = validateUuidParam(c, "violation_id", "Violation ID");
    if (!violationId) return c.res;
    if (!requireTenantCapability(c, "violations.write", "Access denied"))
      return c.res;

    const { tenantId, userId } = getAuthContext(c);
    const body = c.req.valid("json");
    const updated = await applyViolationStatusUpdate(
      violationId,
      tenantId,
      userId,
      body,
    );

    if (!updated) {
      return errorJson(c, 404, "NOT_FOUND", "Violation not found", violationId);
    }

    const [[enriched], { findings, findingSchemas }] = await Promise.all([
      enrichViolations([updated]),
      loadViolationFindings(updated.project_id, tenantId, updated.entity_id),
    ]);

    return c.json({ violation: { ...enriched, findings, findingSchemas } });
  },
);
