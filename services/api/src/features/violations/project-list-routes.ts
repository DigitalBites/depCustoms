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
    const projectIdResult = validateUuidParam(c, "project_id", "Project ID");
    if (!projectIdResult.ok) return projectIdResult.response;
    const projectId = projectIdResult.value;
    const accessResult = await requireViolationProjectAccess(c, projectId);
    if (!accessResult.ok) return accessResult.response;
    const access = accessResult.value;

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
    const projectIdResult = validateUuidParam(c, "project_id", "Project ID");
    if (!projectIdResult.ok) return projectIdResult.response;
    const projectId = projectIdResult.value;
    const accessResult = await requireViolationProjectAccess(c, projectId);
    if (!accessResult.ok) return accessResult.response;
    const access = accessResult.value;

    const {
      status,
      severity,
      since,
      until,
      package_version_id: packageVersionId,
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
        packageVersionId,
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
