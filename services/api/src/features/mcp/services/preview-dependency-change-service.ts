import type { McpRequestContext } from "../context.js";
import { requireMcpProjectAccess } from "./project-access.js";
import {
  loadPackageVersionContext,
  previewPackageDecision,
} from "./package-guidance-service.js";

type PreviewDependencyChangeInput = {
  projectId: string;
  ecosystem: string;
  packageName: string;
  fromVersion: string;
  toVersion: string;
};

function classifyOutcome(args: {
  fromDecision: "allow" | "block";
  toDecision: "allow" | "block";
  fromFindings: number;
  toFindings: number;
}) {
  if (args.fromDecision === "block" && args.toDecision === "allow") {
    return "improves";
  }
  if (args.fromDecision === "allow" && args.toDecision === "block") {
    return "regresses";
  }
  if (args.toFindings < args.fromFindings) {
    return "improves";
  }
  if (args.toFindings > args.fromFindings) {
    return "regresses";
  }
  return "neutral";
}

export async function previewDependencyChangeForMcp(
  ctx: McpRequestContext,
  input: PreviewDependencyChangeInput,
) {
  await requireMcpProjectAccess(ctx.principal, input.projectId);

  const [fromContext, fromPreview, toContext, toPreview] = await Promise.all([
    loadPackageVersionContext(
      input.projectId,
      ctx.principal.tenantId,
      input.ecosystem,
      input.packageName,
      input.fromVersion,
    ),
    previewPackageDecision(
      input.projectId,
      ctx.principal.tenantId,
      input.ecosystem,
      input.packageName,
      input.fromVersion,
    ),
    loadPackageVersionContext(
      input.projectId,
      ctx.principal.tenantId,
      input.ecosystem,
      input.packageName,
      input.toVersion,
    ),
    previewPackageDecision(
      input.projectId,
      ctx.principal.tenantId,
      input.ecosystem,
      input.packageName,
      input.toVersion,
    ),
  ]);

  const policyStatusChange =
    fromPreview.decision === toPreview.decision
      ? `${fromPreview.decision}_to_${toPreview.decision}`
      : `${fromPreview.decision}_to_${toPreview.decision}`;

  return {
    tenant_id: ctx.principal.tenantId,
    project_id: input.projectId,
    ecosystem: input.ecosystem,
    package: input.packageName,
    analysis_mode: "policy_preview_with_stored_snapshots",
    from: {
      version: input.fromVersion,
      decision: fromPreview.decision,
      reason_code: fromPreview.reason_code,
      reason_summary: fromPreview.reason_summary,
      matched_rule: fromPreview.matched_rule,
      enforcement_mode: fromPreview.enforcement_mode,
      observed_findings_count: fromContext.observed_findings_count,
      risk_tier: fromContext.risk_tier,
      fix_version: fromContext.fix_version,
      latest_version: fromContext.latest_version,
      is_latest: fromContext.is_latest,
      recently_observed: fromContext.recently_observed,
      contributor_context: fromContext.contributor_context
        ? {
            ...fromContext.contributor_context,
            snapshot_status: fromPreview.snapshot_statuses.contributor ?? null,
          }
        : null,
    },
    to: {
      version: input.toVersion,
      decision: toPreview.decision,
      reason_code: toPreview.reason_code,
      reason_summary: toPreview.reason_summary,
      matched_rule: toPreview.matched_rule,
      enforcement_mode: toPreview.enforcement_mode,
      observed_findings_count: toContext.observed_findings_count,
      risk_tier: toContext.risk_tier,
      fix_version: toContext.fix_version,
      latest_version: toContext.latest_version,
      is_latest: toContext.is_latest,
      recently_observed: toContext.recently_observed,
      contributor_context: toContext.contributor_context
        ? {
            ...toContext.contributor_context,
            snapshot_status: toPreview.snapshot_statuses.contributor ?? null,
          }
        : null,
    },
    comparison: {
      policy_status_change: policyStatusChange,
      outcome: classifyOutcome({
        fromDecision: fromPreview.decision,
        toDecision: toPreview.decision,
        fromFindings: fromContext.observed_findings_count,
        toFindings: toContext.observed_findings_count,
      }),
      findings_delta:
        toContext.observed_findings_count - fromContext.observed_findings_count,
      moves_to_latest: Boolean(toContext.is_latest),
      matches_known_fix_version:
        Boolean(fromContext.fix_version) &&
        fromContext.fix_version === input.toVersion,
    },
  };
}
