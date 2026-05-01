import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  policy_evaluations,
  violation_occurrences,
  violations,
} from "../../db/schema.js";
import { getAuthContext, requireProjectAccess } from "../../http/guards.js";
import {
  entityEvaluationsQuerySchema,
  projectEvaluationsQuerySchema,
} from "./shared.js";

export const projectPolicyEvaluationsRouter = new Hono();

projectPolicyEvaluationsRouter.get(
  "/v1/projects/:project_id/policy-evaluations",
  zValidator("query", projectEvaluationsQuerySchema),
  async (c) => {
    const accessResult = await requireProjectAccess(c, {
      hideForbiddenAsNotFound: true,
    });
    if (!accessResult.ok) return accessResult.response;
    const access = accessResult.value;

    const { projectId } = access;
    const { tenantId } = getAuthContext(c);
    const {
      decision,
      entity_id: entityId,
      since,
      limit,
      offset,
    } = c.req.valid("query");

    const conditions = [
      eq(policy_evaluations.project_id, projectId),
      eq(policy_evaluations.tenant_id, tenantId),
    ];

    if (decision) conditions.push(eq(policy_evaluations.decision, decision));
    if (entityId) conditions.push(eq(policy_evaluations.entity_id, entityId));
    if (since) conditions.push(gte(policy_evaluations.evaluated_at, since));

    const rows = await db
      .select()
      .from(policy_evaluations)
      .where(
        and(
          ...(conditions as [
            ReturnType<typeof eq>,
            ...ReturnType<typeof eq>[],
          ]),
        ),
      )
      .orderBy(desc(policy_evaluations.evaluated_at))
      .limit(limit)
      .offset(offset);

    return c.json({ evaluations: rows, limit, offset });
  },
);

projectPolicyEvaluationsRouter.get(
  "/v1/projects/:project_id/policy-evaluations/entity/:entity_id",
  zValidator("query", entityEvaluationsQuerySchema),
  async (c) => {
    const accessResult = await requireProjectAccess(c, {
      hideForbiddenAsNotFound: true,
    });
    if (!accessResult.ok) return accessResult.response;
    const access = accessResult.value;

    const { projectId } = access;
    const { tenantId } = getAuthContext(c);
    const entityId = c.req.param("entity_id");
    const { limit } = c.req.valid("query");

    const evaluations = await db
      .select()
      .from(policy_evaluations)
      .where(
        and(
          eq(policy_evaluations.project_id, projectId),
          eq(policy_evaluations.tenant_id, tenantId),
          eq(policy_evaluations.entity_id, entityId),
        ),
      )
      .orderBy(desc(policy_evaluations.evaluated_at))
      .limit(limit);

    if (evaluations.length === 0) {
      return c.json({ evaluations: [], violations: [] });
    }

    const evaluationIds = evaluations.map((evaluation) => evaluation.id);
    const linkedViolations = await db
      .select({
        id: violations.id,
        tenant_id: violations.tenant_id,
        project_id: violations.project_id,
        rule_id: violations.rule_id,
        policy_id: violations.policy_id,
        rule_name: violations.rule_name,
        policy_name: violations.policy_name,
        recommended_remediation: violations.recommended_remediation,
        dedupe_key: violations.dedupe_key,
        entity_id: violations.entity_id,
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
      .where(
        and(
          inArray(violation_occurrences.evaluation_id, evaluationIds),
          eq(violation_occurrences.tenant_id, tenantId),
        ),
      );

    return c.json({ evaluations, violations: linkedViolations });
  },
);
