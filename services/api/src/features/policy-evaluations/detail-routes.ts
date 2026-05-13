import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  policies,
  policy_evaluations,
  rules,
  violation_occurrences,
  violations,
} from "../../db/schema.js";
import {
  getAuthContext,
  requireResolvedProjectAccess,
} from "../../http/guards.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";

export const policyEvaluationDetailRouter = new Hono();

policyEvaluationDetailRouter.get(
  "/v1/policy-evaluations/:evaluation_id",
  async (c) => {
    const evaluationIdResult = validateUuidParam(c, "evaluation_id", "Evaluation ID");
    if (!evaluationIdResult.ok) return evaluationIdResult.response;
    const evaluationId = evaluationIdResult.value;

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

    const projectAccessResult = await requireResolvedProjectAccess(
      c,
      evaluation.project_id,
      { hideForbiddenAsNotFound: true },
    );
    if (!projectAccessResult.ok) return projectAccessResult.response;

    const linkedViolations = await db
      .select({
        id: violations.id,
        tenant_id: violations.tenant_id,
        project_id: violations.project_id,
        rule_id: violations.rule_id,
        policy_id: violations.policy_id,
        rule_name: rules.name,
        policy_name: policies.name,
        recommended_remediation: violations.recommended_remediation,
        entity_type: violations.entity_type,
        severity: violations.severity,
        code: violations.code,
        message: violations.message,
        enforcement_mode: violations.enforcement_mode,
        blocked: violations.blocked,
        status: violations.status,
        status_note: violations.status_note,
        first_seen_at: violations.first_seen_at,
        last_seen_at: violations.last_seen_at,
        created_at: violations.created_at,
      })
      .from(violation_occurrences)
      .innerJoin(violations, eq(violation_occurrences.violation_id, violations.id))
      .leftJoin(rules, eq(violations.rule_id, rules.id))
      .leftJoin(policies, eq(violations.policy_id, policies.id))
      .where(
        and(
          eq(violation_occurrences.evaluation_id, evaluationId),
          eq(violation_occurrences.tenant_id, tenantId),
        ),
      );

    return c.json({ evaluation, violations: linkedViolations });
  },
);
