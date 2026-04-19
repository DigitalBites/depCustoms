import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { validateUuidParam } from "../../http/responses.js";
import { enrichViolations } from "./enrichment.js";
import {
  listProjectViolations,
  loadProjectViolationSummary,
  requireViolationProjectAccess,
} from "./project-shared.js";
import { violationsListQuerySchema } from "./query-schemas.js";
import { formatViolationSummary } from "./summary-format.js";

export const projectViolationListRouter = new Hono();

projectViolationListRouter.get(
  "/v1/projects/:project_id/violations/summary",
  async (c) => {
    const projectId = validateUuidParam(c, "project_id", "Project ID");
    if (!projectId) return c.res;
    const access = await requireViolationProjectAccess(c, projectId);
    if (!access) return c.res;

    const summary = await loadProjectViolationSummary(
      projectId,
      access.project.tenant_id,
    );
    return c.json(formatViolationSummary(summary));
  },
);

projectViolationListRouter.get(
  "/v1/projects/:project_id/violations",
  zValidator("query", violationsListQuerySchema),
  async (c) => {
    const projectId = validateUuidParam(c, "project_id", "Project ID");
    if (!projectId) return c.res;
    const access = await requireViolationProjectAccess(c, projectId);
    if (!access) return c.res;

    const {
      status,
      severity,
      since,
      until,
      entity_id: entityId,
      search,
      rule_id: ruleId,
      policy_id: policyId,
      limit,
      offset,
    } = c.req.valid("query");

    const rows = await listProjectViolations(
      projectId,
      access.project.tenant_id,
      {
        status,
        severity,
        since,
        until,
        entityId,
        search,
        ruleId,
        policyId,
        limit,
        offset,
      },
    );

    const enriched = await enrichViolations(rows);
    return c.json({ violations: enriched, limit, offset });
  },
);
