import { Hono } from "hono";
import {
  getAuthContext,
  requireProjectAccess,
  requireTenantCapability,
} from "../../http/guards.js";
import { loadProjectOsvSummary } from "./package-summary-queries.js";

export const projectSecurityPackageSummaryRouter = new Hono();

projectSecurityPackageSummaryRouter.get(
  "/v1/projects/:project_id/connectors/osv/summary",
  async (c) => {
    const capabilityResult = requireTenantCapability(c, "packages.read_project", "Access denied");
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    const accessResult = await requireProjectAccess(c);
    if (!accessResult.ok) return accessResult.response;
    const access = accessResult.value;

    const { projectId } = access;
    const { tenantId } = getAuthContext(c);
    const { summary, fixNotAppliedSet } = await loadProjectOsvSummary(
      projectId,
      tenantId,
    );

    const total = Number(summary.total_packages ?? 0);
    const critical = Number(summary.critical_count ?? 0);
    const high = Number(summary.high_count ?? 0);
    const medium = Number(summary.medium_count ?? 0);
    const low = Number(summary.low_count ?? 0);
    const vulnerable = critical + high + medium + low;
    const oldestAdvisory = summary.oldest_crit_high_advisory
      ? new Date(summary.oldest_crit_high_advisory as string).toISOString()
      : null;

    return c.json({
      projectId,
      computedAt: new Date().toISOString(),
      lastSyncedAt:
        summary.last_synced_at instanceof Date
          ? summary.last_synced_at.toISOString()
          : summary.last_synced_at
            ? new Date(summary.last_synced_at as string).toISOString()
            : null,
      packages: {
        total,
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
