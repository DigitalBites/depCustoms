import { Hono } from "hono";
import {
  listAccessibleProjectIds,
  requireTenantCapabilityAccess,
} from "../../http/guards.js";
import { loadTenantOsvSummary } from "./tenant-package-shared.js";

export const tenantSecuritySummaryRouter = new Hono();

tenantSecuritySummaryRouter.get(
  "/v1/tenants/:tenant_id/connectors/osv/summary",
  async (c) => {
    const tenantIdResult = requireTenantCapabilityAccess(
      c,
      "security.read_tenant",
      "You do not have access to view tenant security data",
    );
    if (!tenantIdResult.ok) return tenantIdResult.response;
    const tenantId = tenantIdResult.value;

    const allowedProjectIds = await listAccessibleProjectIds(c);
    const { summary, rawLastSynced, fixNotAppliedSet } =
      await loadTenantOsvSummary(tenantId, allowedProjectIds);

    const critical = Number(summary.critical_count ?? 0);
    const high = Number(summary.high_count ?? 0);
    const medium = Number(summary.medium_count ?? 0);
    const low = Number(summary.low_count ?? 0);
    const vulnerable = critical + high + medium + low;
    const oldestAdvisory = summary.oldest_crit_high_advisory
      ? new Date(summary.oldest_crit_high_advisory as string).toISOString()
      : null;
    const lastSyncedAt = rawLastSynced
      ? new Date(rawLastSynced).toISOString()
      : null;

    return c.json({
      tenantId,
      computedAt: new Date().toISOString(),
      lastSyncedAt,
      packages: {
        total: Number(summary.total_packages ?? 0),
        unscanned: Number(summary.unscanned_count ?? 0),
        clean: Number(summary.clean_count ?? 0),
        vulnerable,
        bySeverity: { critical, high, medium, low },
      },
      fixes: {
        available: Number(summary.fixable_count ?? 0),
        availableNotApplied: fixNotAppliedSet.size,
      },
      exploitability: {
        networkExploitable: Number(summary.network_exploitable_count ?? 0),
      },
      oldestUnresolvedAdvisory: oldestAdvisory,
      oldestUnresolvedDays: oldestAdvisory
        ? Math.floor(
            (Date.now() - new Date(oldestAdvisory).getTime()) / 86_400_000,
          )
        : null,
    });
  },
);
