import type { McpRequestContext } from "../context.js";
import { requireMcpProjectAccess } from "./project-access.js";
import {
  loadPackageVersionContext,
  previewPackageDecision,
} from "./package-guidance-service.js";

type ExplainPackageDecisionInput = {
  projectId: string;
  ecosystem: string;
  packageName: string;
  version: string;
};

export async function explainPackageDecisionForMcp(
  ctx: McpRequestContext,
  input: ExplainPackageDecisionInput,
) {
  await requireMcpProjectAccess(ctx.principal, input.projectId);

  const [context, preview] = await Promise.all([
    loadPackageVersionContext(
      input.projectId,
      ctx.principal.tenantId,
      input.ecosystem,
      input.packageName,
      input.version,
    ),
    previewPackageDecision(
      input.projectId,
      ctx.principal.tenantId,
      input.ecosystem,
      input.packageName,
      input.version,
    ),
  ]);

  return {
    tenant_id: ctx.principal.tenantId,
    project_id: input.projectId,
    ecosystem: input.ecosystem,
    package: input.packageName,
    version: input.version,
    decision: preview.decision,
    reason_code: preview.reason_code,
    reason_summary:
      preview.reason_summary ||
      context.last_block_reason_summary ||
      (context.open_findings_count > 0
        ? `Open findings detected for ${input.packageName}@${input.version}`
        : "No blocking policy match found"),
    matched_rule: preview.matched_rule ?? context.last_block_matched_rule,
    enforcement_mode:
      preview.enforcement_mode ?? context.last_block_enforcement_mode,
    decision_basis: "policy_preview_with_stored_snapshots",
    finding_summary: context.finding_summary,
    open_findings_count: context.open_findings_count,
    max_severity: context.max_severity,
    vuln_count: context.vuln_count,
    fix_available: context.fix_available,
    fix_version: context.fix_version,
    recently_observed: context.recently_observed,
    recent_blocks: context.historical_blocks_count,
    last_seen_at: context.last_seen_at,
    first_seen_at: context.first_seen_at,
    request_count: context.request_count,
    allow_count: context.allow_count,
    block_count: context.block_count,
    used_version_published_at: context.used_version_published_at,
    latest_version: context.latest_version,
    latest_version_published_at: context.latest_version_published_at,
    is_latest: context.is_latest,
    last_blocked_at: context.last_blocked_at,
    contributor_context: context.contributor_context
      ? {
          ...context.contributor_context,
          snapshot_status: preview.snapshot_statuses.contributor ?? null,
        }
      : null,
    snapshot_statuses: preview.snapshot_statuses,
    policies_evaluated: preview.policies_evaluated,
    rules_evaluated: preview.rules_evaluated,
    rules_matched: preview.rules_matched,
  };
}
