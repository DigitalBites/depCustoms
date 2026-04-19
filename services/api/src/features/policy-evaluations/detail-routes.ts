import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { policy_evaluations, violations } from "../../db/schema.js";
import {
  getAuthContext,
  requireResolvedProjectAccess,
} from "../../http/guards.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";

export const policyEvaluationDetailRouter = new Hono();

policyEvaluationDetailRouter.get(
  "/v1/policy-evaluations/:evaluation_id",
  async (c) => {
    const evaluationId = validateUuidParam(c, "evaluation_id", "Evaluation ID");
    if (!evaluationId) return c.res;

    const { tenantId } = getAuthContext(c);
    const [evaluation] = await db
      .select()
      .from(policy_evaluations)
      .where(
        and(
          eq(policy_evaluations.id, evaluationId),
          eq(policy_evaluations.tenant_id, tenantId),
        ),
      )
      .limit(1);

    if (!evaluation) {
      return errorJson(
        c,
        404,
        "NOT_FOUND",
        "Evaluation not found",
        evaluationId,
      );
    }

    const projectAccess = await requireResolvedProjectAccess(
      c,
      evaluation.project_id,
      { hideForbiddenAsNotFound: true },
    );
    if (!projectAccess) return c.res;

    const linkedViolations = await db
      .select()
      .from(violations)
      .where(
        and(
          eq(violations.evaluation_id, evaluationId),
          eq(violations.tenant_id, tenantId),
        ),
      );

    return c.json({ evaluation, violations: linkedViolations });
  },
);
