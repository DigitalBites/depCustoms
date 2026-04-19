import type { McpRequestContext } from "../context.js";
import { requireMcpProjectAccess } from "./project-access.js";
import { loadProjectContributorSummary } from "../../security/contributor-package-list-queries.js";
import { buildContributorSummaryResponse } from "../../security/serializers.js";

export async function getProjectContributorSummaryForMcp(
  ctx: McpRequestContext,
  projectId: string,
) {
  await requireMcpProjectAccess(ctx.principal, projectId);

  const summary = await loadProjectContributorSummary(
    projectId,
    ctx.principal.tenantId,
  );
  const response = buildContributorSummaryResponse(
    summary,
    new Date().toISOString(),
  );

  return {
    tenant_id: ctx.principal.tenantId,
    project_id: projectId,
    computed_at: response.computedAt,
    last_scored_at: response.lastScoredAt,
    packages: {
      total_scanned: response.packages.totalScanned,
      not_scanned: response.packages.notScanned,
      by_risk: {
        high: response.packages.byRisk.high,
        medium: response.packages.byRisk.medium,
        low: response.packages.byRisk.low,
        clean: response.packages.byRisk.clean,
      },
    },
    signals: {
      new_maintainer_count: response.signals.newMaintainerCount,
      first_time_publisher_count: response.signals.firstTimePublisherCount,
      publisher_change_count: response.signals.publisherChangeCount,
      install_scripts_count: response.signals.installScriptsCount,
    },
  };
}
