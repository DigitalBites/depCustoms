import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  policy_evaluations,
  violation_occurrences,
  violations,
} from "../../db/schema.js";
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
  const violationIdResult = validateUuidParam(c, "violation_id", "Violation ID");
  if (!violationIdResult.ok) return violationIdResult.response;
  const violationId = violationIdResult.value;

  const capabilityResult = requireTenantCapability(c, "violations.read_project", "Access denied");
  if (!capabilityResult.ok) {
    return capabilityResult.response;
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

  const accessResult = await requireResolvedProjectAccess(c, violation.project_id);
  if (!accessResult.ok) return accessResult.response;

  const [[enriched], { findings, findingSchemas, presentations }] = await Promise.all([
    enrichViolations([violation]),
    loadViolationFindings(violation.project_id, tenantId, violation.entity_id),
  ]);
  const [latestEvaluation] = await db
    .select({
      id: policy_evaluations.id,
      event_id: policy_evaluations.event_id,
      evaluated_at: policy_evaluations.evaluated_at,
      field_values_at_evaluation:
        policy_evaluations.field_values_at_evaluation,
    })
    .from(violation_occurrences)
    .innerJoin(
      policy_evaluations,
      eq(violation_occurrences.evaluation_id, policy_evaluations.id),
    )
    .where(
      and(
        eq(violation_occurrences.violation_id, violation.id),
        eq(violation_occurrences.tenant_id, tenantId),
      ),
    )
    .orderBy(desc(policy_evaluations.evaluated_at))
    .limit(1);

  return c.json({
    violation: {
      ...enriched,
      findings,
      findingSchemas,
      presentations,
      latestEvaluation: latestEvaluation ?? null,
    },
  });
});

projectViolationDetailRouter.patch(
  "/v1/violations/bulk-status",
  zValidator("json", bulkViolationStatusUpdateSchema),
  async (c) => {
    const capabilityResult = requireTenantCapability(c, "violations.write", "Access denied");
    if (!capabilityResult.ok) return capabilityResult.response;

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
    const violationIdResult = validateUuidParam(c, "violation_id", "Violation ID");
    if (!violationIdResult.ok) return violationIdResult.response;
    const violationId = violationIdResult.value;
    const capabilityResult = requireTenantCapability(c, "violations.write", "Access denied");
    if (!capabilityResult.ok) return capabilityResult.response;

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

  const [[enriched], { findings, findingSchemas, presentations }] = await Promise.all([
    enrichViolations([updated]),
    loadViolationFindings(updated.project_id, tenantId, updated.entity_id),
  ]);
  const [latestEvaluation] = await db
    .select({
      id: policy_evaluations.id,
      event_id: policy_evaluations.event_id,
      evaluated_at: policy_evaluations.evaluated_at,
      field_values_at_evaluation:
        policy_evaluations.field_values_at_evaluation,
    })
    .from(violation_occurrences)
    .innerJoin(
      policy_evaluations,
      eq(violation_occurrences.evaluation_id, policy_evaluations.id),
    )
    .where(
      and(
        eq(violation_occurrences.violation_id, updated.id),
        eq(violation_occurrences.tenant_id, tenantId),
      ),
    )
    .orderBy(desc(policy_evaluations.evaluated_at))
    .limit(1);

  return c.json({
    violation: {
      ...enriched,
      findings,
      findingSchemas,
      presentations,
      latestEvaluation: latestEvaluation ?? null,
    },
  });
  },
);
