import type { McpRequestContext } from "../context.js";
import { requireMcpProjectAccess } from "./project-access.js";
import {
  listObservedProjectPackageVersions,
  toIsoString,
} from "./package-guidance-service.js";
import { suggestAllowedVersionsForMcp } from "./suggest-allowed-versions-service.js";

type GetProjectDependencyContextInput = {
  projectId: string;
  ecosystem: string;
  packageName: string;
};

export async function getProjectDependencyContextForMcp(
  ctx: McpRequestContext,
  input: GetProjectDependencyContextInput,
) {
  await requireMcpProjectAccess(ctx.principal, input.projectId);

  const observedRows = await listObservedProjectPackageVersions(
    input.projectId,
    ctx.principal.tenantId,
    input.ecosystem,
    input.packageName,
  );

  const suggestion = await suggestAllowedVersionsForMcp(ctx, {
    projectId: input.projectId,
    ecosystem: input.ecosystem,
    packageName: input.packageName,
    currentVersion: observedRows[0]?.version ?? null,
  });

  const suggestionByVersion = new Map(
    suggestion.candidates.map((candidate) => [candidate.version, candidate]),
  );

  const versions = observedRows.map((row) => {
    const preview = suggestionByVersion.get(row.version);

    return {
      version: row.version,
      used_version_published_at: toIsoString(row.used_version_published_at),
      latest_version: row.latest_version,
      latest_version_published_at: toIsoString(row.latest_version_published_at),
      is_latest: row.is_latest,
      fix_available: row.fix_available ?? false,
      fix_version: row.fix_version ?? null,
      max_severity: row.max_severity ?? null,
      vuln_count: row.vuln_count ?? 0,
      request_count: row.request_count ?? 0,
      allow_count: row.allow_count ?? 0,
      block_count: row.block_count ?? 0,
      first_seen_at: toIsoString(row.first_seen_at),
      last_seen_at: toIsoString(row.last_seen_at),
      decision: preview?.decision ?? "allow",
      reason_code: preview?.reason_code ?? "unknown",
      reason_summary: preview?.reason_summary ?? "No preview available",
      matched_rule: preview?.matched_rule ?? null,
      enforcement_mode: preview?.enforcement_mode ?? null,
      contributor_context:
        row.contributor_score_tier !== null &&
        row.contributor_score_tier !== undefined
          ? {
              risk_score: row.contributor_risk_score ?? 0,
              score_tier: row.contributor_score_tier ?? null,
              publisher: row.contributor_publisher ?? null,
              publisher_seen_before_package:
                row.contributor_publisher_seen_before_package ?? null,
              publisher_seen_count_before:
                row.contributor_publisher_seen_count_before ?? null,
              publisher_matches_prior_version:
                row.contributor_publisher_matches_prior_version ?? null,
              maintainer_set_changed:
                row.contributor_maintainer_set_changed ?? null,
              new_maintainer_count:
                row.contributor_new_maintainer_count ?? null,
              removed_maintainer_count:
                row.contributor_removed_maintainer_count ?? null,
              maintainer_count: row.contributor_maintainer_count ?? null,
              has_install_scripts: row.contributor_has_install_scripts ?? null,
              has_provenance: row.contributor_has_provenance ?? null,
              has_trusted_publisher:
                row.contributor_has_trusted_publisher ?? null,
              release_velocity_7d: row.contributor_release_velocity_7d ?? null,
              release_velocity_30d:
                row.contributor_release_velocity_30d ?? null,
              history_complete: row.contributor_history_complete ?? null,
              raw_factors: row.contributor_raw_factors ?? null,
              last_scored_at: toIsoString(row.contributor_last_scored_at),
              snapshot_status: null,
            }
          : null,
    };
  });

  return {
    tenant_id: ctx.principal.tenantId,
    project_id: input.projectId,
    ecosystem: input.ecosystem,
    package: input.packageName,
    latest_known_version: versions[0]?.latest_version ?? null,
    latest_known_version_published_at:
      versions[0]?.latest_version_published_at ?? null,
    observed_versions_count: versions.length,
    recommended_version:
      suggestion.suggested_version ??
      versions.find((version) => version.is_latest)?.version ??
      versions[0]?.latest_version ??
      null,
    versions,
    suggestions: suggestion.candidates,
  };
}
