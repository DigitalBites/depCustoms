import type { McpRequestContext } from "../context.js";
import { requireMcpProjectAccess } from "./project-access.js";
import {
  listObservedProjectPackageVersions,
  loadLatestKnownPackageVersion,
  loadPackageVersionContext,
  previewPackageDecision,
  severityRank,
} from "./package-guidance-service.js";

type SuggestAllowedVersionsInput = {
  projectId: string;
  ecosystem: string;
  packageName: string;
  currentVersion?: string | null;
};

export async function suggestAllowedVersionsForMcp(
  ctx: McpRequestContext,
  input: SuggestAllowedVersionsInput,
) {
  await requireMcpProjectAccess(ctx.principal, input.projectId);

  const observedRows = await listObservedProjectPackageVersions(
    input.projectId,
    ctx.principal.tenantId,
    input.ecosystem,
    input.packageName,
  );

  const candidateVersions = new Set<string>();
  if (input.currentVersion) candidateVersions.add(input.currentVersion);

  for (const row of observedRows) {
    candidateVersions.add(row.version);
    if (row.latest_version) candidateVersions.add(row.latest_version);
    if (row.fix_version) candidateVersions.add(row.fix_version);
  }

  const hasLatestCandidate = observedRows.some(
    (row) => row.is_latest || Boolean(row.latest_version),
  );
  if (!hasLatestCandidate) {
    const latestKnown = await loadLatestKnownPackageVersion(
      input.ecosystem,
      input.packageName,
    );
    if (latestKnown?.version) {
      candidateVersions.add(latestKnown.version);
    }
  }

  const currentRow = input.currentVersion
    ? (observedRows.find((row) => row.version === input.currentVersion) ?? null)
    : (observedRows[0] ?? null);

  const currentFixVersion = currentRow?.fix_version ?? null;

  const evaluatedCandidates = await Promise.all(
    [...candidateVersions].map(async (version) => {
      const [context, preview] = await Promise.all([
        loadPackageVersionContext(
          input.projectId,
          ctx.principal.tenantId,
          input.ecosystem,
          input.packageName,
          version,
        ),
        previewPackageDecision(
          input.projectId,
          ctx.principal.tenantId,
          input.ecosystem,
          input.packageName,
          version,
        ),
      ]);

      const reasons: string[] = [];
      let score = 0;

      if (preview.decision === "allow") {
        score += 1000;
        reasons.push("currently allowed by effective policy");
      } else {
        reasons.push(preview.reason_summary);
      }

      if (context.is_latest) {
        score += 250;
        reasons.push("matches the latest known version");
      } else if (context.latest_version) {
        reasons.push(`latest known version is ${context.latest_version}`);
      }

      if (currentFixVersion && version === currentFixVersion) {
        score += 180;
        reasons.push("matches the known fix version");
      }

      if (context.fix_version && version === context.fix_version) {
        score += 120;
      }

      if (context.observed_findings_count === 0) {
        score += 90;
        reasons.push("no observed findings recorded for this version");
      } else {
        score -= context.observed_findings_count * 20;
        reasons.push(`${context.observed_findings_count} observed findings recorded`);
      }

      score -= severityRank(context.risk_tier) * 15;

      if (context.recently_observed) {
        score += 35;
        reasons.push("already observed in this project");
      }

      if (input.currentVersion && version === input.currentVersion) {
        score -= 10;
      }

      return {
        version,
        decision: preview.decision,
        reason_code: preview.reason_code,
        reason_summary: preview.reason_summary,
        matched_rule: preview.matched_rule,
        enforcement_mode: preview.enforcement_mode,
        used_version_published_at: context.used_version_published_at,
        latest_version: context.latest_version,
        latest_version_published_at: context.latest_version_published_at,
        is_latest: context.is_latest,
        remediation_available: context.remediation_available,
        fix_version: context.fix_version,
        observed_findings_count: context.observed_findings_count,
        risk_tier: context.risk_tier,
        recently_observed: context.recently_observed,
        request_count: context.request_count,
        recommendation_score: score,
        why_preferred: reasons,
      };
    }),
  );

  evaluatedCandidates.sort((left, right) => {
    if (left.recommendation_score !== right.recommendation_score) {
      return right.recommendation_score - left.recommendation_score;
    }
    return left.version.localeCompare(right.version);
  });

  const allowed = evaluatedCandidates.filter(
    (candidate) => candidate.decision === "allow",
  );

  return {
    tenant_id: ctx.principal.tenantId,
    project_id: input.projectId,
    ecosystem: input.ecosystem,
    package: input.packageName,
    current_version: input.currentVersion ?? null,
    analysis_mode: "observed_versions_plus_latest_and_fix_candidates",
    suggested_version: allowed[0]?.version ?? null,
    candidates: evaluatedCandidates,
  };
}
