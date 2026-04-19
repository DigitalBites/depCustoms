import { Hono } from "hono";
import {
  getAuthContext,
  requireProjectAccess,
  requireTenantCapability,
} from "../../http/guards.js";
import { loadProjectSecuritySummaryRow } from "./project-security-summary-query.js";

export const projectSecuritySummaryRouter = new Hono();

projectSecuritySummaryRouter.get(
  "/v1/projects/:project_id/security-summary",
  async (c) => {
    if (
      !requireTenantCapability(
        c,
        "security.read_project",
        "You do not have access to view project security data",
      )
    ) {
      return c.res;
    }

    const access = await requireProjectAccess(c);
    if (!access) return c.res;

    const { projectId } = access;
    const { tenantId } = getAuthContext(c);

    const now = new Date();
    const summaryRow = await loadProjectSecuritySummaryRow(
      projectId,
      tenantId,
      now,
    );
    const oldestOpenAt = summaryRow?.oldest_open_at
      ? new Date(summaryRow.oldest_open_at)
      : null;
    const blocks7d = Number(summaryRow?.blocks_7d ?? 0);
    const blocksPrior7d = Number(summaryRow?.blocks_prior_7d ?? 0);

    return c.json({
      projectId,
      computedAt: now.toISOString(),
      findings: {
        open: Number(summaryRow?.open_count ?? 0),
        suppressed: Number(summaryRow?.suppressed_count ?? 0),
        bySeverity: {
          critical: Number(summaryRow?.critical_open_count ?? 0),
          high: Number(summaryRow?.high_open_count ?? 0),
          medium: Number(summaryRow?.medium_open_count ?? 0),
          low: Number(summaryRow?.low_open_count ?? 0),
        },
        oldestOpenDays: oldestOpenAt
          ? Math.floor((Date.now() - oldestOpenAt.getTime()) / 86_400_000)
          : null,
      },
      violations: {
        blocks30d: Number(summaryRow?.blocks_30d ?? 0),
        blocks7d,
        trend7d: blocks7d - blocksPrior7d,
      },
      suppressions: Number(summaryRow?.suppressions_count ?? 0),
      connectors: {
        osv: {
          lastSyncedAt: summaryRow?.last_synced_at?.toISOString() ?? null,
          newFindings: summaryRow?.new_findings ?? null,
          syncedCount: summaryRow?.synced_count ?? null,
        },
      },
    });
  },
);
