import { Hono } from "hono";
import {
  listAccessibleProjectIds,
  requireTenantCapabilityAccess,
} from "../../http/guards.js";
import { loadTenantSecuritySummaryRow } from "./tenant-security-summary-query.js";

export const tenantSecurityPageSummaryRouter = new Hono();

tenantSecurityPageSummaryRouter.get(
  "/v1/tenants/:tenant_id/security-summary",
  async (c) => {
    const tenantId = requireTenantCapabilityAccess(
      c,
      "security.read_tenant",
      "You do not have access to view tenant security data",
    );
    if (!tenantId) return c.res;

    const allowedProjectIds = await listAccessibleProjectIds(c);
    const now = new Date();
    const summaryRow = await loadTenantSecuritySummaryRow(
      tenantId,
      allowedProjectIds,
      now,
    );
    const oldestOpenAt = summaryRow?.oldest_open_at
      ? new Date(summaryRow.oldest_open_at)
      : null;
    const blocks7d = Number(summaryRow?.blocks_7d ?? 0);
    const blocksPrior7d = Number(summaryRow?.blocks_prior_7d ?? 0);

    return c.json({
      tenantId,
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
          newFindings:
            summaryRow?.new_findings !== null
              ? Number(summaryRow?.new_findings ?? 0)
              : null,
          syncedCount:
            summaryRow?.synced_count !== null
              ? Number(summaryRow?.synced_count ?? 0)
              : null,
        },
      },
    });
  },
);
