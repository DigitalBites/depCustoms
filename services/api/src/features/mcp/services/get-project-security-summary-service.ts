import type { McpRequestContext } from "../context.js";
import { requireMcpProjectAccess } from "./project-access.js";
import { loadProjectSecuritySummaryRow } from "../../security/project-security-summary-query.js";
import { loadProjectContributorSummary } from "../../security/contributor-package-list-queries.js";

export async function getProjectSecuritySummaryForMcp(
  ctx: McpRequestContext,
  projectId: string,
) {
  await requireMcpProjectAccess(ctx.principal, projectId);

  const now = new Date();
  const [summaryRow, contributorSummary] = await Promise.all([
    loadProjectSecuritySummaryRow(projectId, ctx.principal.tenantId, now),
    loadProjectContributorSummary(projectId, ctx.principal.tenantId),
  ]);
  const oldestOpenAt = summaryRow?.oldest_open_at
    ? new Date(summaryRow.oldest_open_at)
    : null;
  const blocks7d = Number(summaryRow?.blocks_7d ?? 0);
  const blocksPrior7d = Number(summaryRow?.blocks_prior_7d ?? 0);

  return {
    project_id: projectId,
    tenant_id: ctx.principal.tenantId,
    computed_at: now.toISOString(),
    findings: {
      open: Number(summaryRow?.open_count ?? 0),
      suppressed: Number(summaryRow?.suppressed_count ?? 0),
      by_severity: {
        critical: Number(summaryRow?.critical_open_count ?? 0),
        high: Number(summaryRow?.high_open_count ?? 0),
        medium: Number(summaryRow?.medium_open_count ?? 0),
        low: Number(summaryRow?.low_open_count ?? 0),
      },
      oldest_open_days: oldestOpenAt
        ? Math.floor((Date.now() - oldestOpenAt.getTime()) / 86_400_000)
        : null,
    },
    violations: {
      blocks_30d: Number(summaryRow?.blocks_30d ?? 0),
      blocks_7d: blocks7d,
      trend_7d: blocks7d - blocksPrior7d,
    },
    suppressions: Number(summaryRow?.suppressions_count ?? 0),
    connectors: {
      osv: {
        last_synced_at: summaryRow?.last_synced_at?.toISOString() ?? null,
        new_findings: summaryRow?.new_findings ?? null,
        synced_count: summaryRow?.synced_count ?? null,
      },
      contributor: {
        last_scored_at:
          contributorSummary?.last_scored_at instanceof Date
            ? contributorSummary.last_scored_at.toISOString()
            : contributorSummary?.last_scored_at
              ? new Date(contributorSummary.last_scored_at).toISOString()
              : null,
        packages: {
          total_scanned: Number(contributorSummary?.total_scanned ?? 0),
          not_scanned: Number(contributorSummary?.not_scanned_count ?? 0),
          by_risk: {
            high: Number(contributorSummary?.high_risk_count ?? 0),
            medium: Number(contributorSummary?.medium_risk_count ?? 0),
            low: Number(contributorSummary?.low_risk_count ?? 0),
            clean: Number(contributorSummary?.clean_count ?? 0),
          },
        },
        signals: {
          new_maintainer_count: Number(
            contributorSummary?.new_maintainer_count ?? 0,
          ),
          first_time_publisher_count: Number(
            contributorSummary?.first_time_publisher_count ?? 0,
          ),
          publisher_change_count: Number(
            contributorSummary?.publisher_change_count ?? 0,
          ),
          install_scripts_count: Number(
            contributorSummary?.install_scripts_count ?? 0,
          ),
        },
      },
    },
  };
}
