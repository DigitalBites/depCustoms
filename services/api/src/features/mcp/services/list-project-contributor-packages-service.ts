import type { McpRequestContext } from "../context.js";
import { requireMcpProjectAccess } from "./project-access.js";
import { listProjectContributorPackages } from "../../security/contributor-package-list-queries.js";
import { buildContributorPackageResponse } from "../../security/serializers.js";

type ContributorPackageFilters = {
  score_tier?: "LOW" | "MEDIUM" | "HIGH" | "NONE";
  min_score?: number;
  limit?: number;
  offset?: number;
};

export async function listProjectContributorPackagesForMcp(
  ctx: McpRequestContext,
  projectId: string,
  filters: ContributorPackageFilters,
) {
  await requireMcpProjectAccess(ctx.principal, projectId);

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const { packages, total } = await listProjectContributorPackages(
    projectId,
    ctx.principal.tenantId,
    {
      scoreTier: filters.score_tier,
      minScore: filters.min_score,
      limit,
      offset,
    },
  );

  return {
    tenant_id: ctx.principal.tenantId,
    project_id: projectId,
    packages: packages.map((pkg) => {
      const contributor = buildContributorPackageResponse(pkg);
      return {
        ecosystem: contributor.ecosystem,
        package: contributor.name,
        version: contributor.version,
        version_published_at: contributor.versionPublishedAt,
        latest_version: contributor.latestVersion,
        contributor_context: {
          risk_score: contributor.score,
          score_tier: contributor.scoreTier,
          publisher: contributor.publisher,
          publisher_seen_before_package: contributor.publisherSeenBeforePackage,
          publisher_seen_count_before: contributor.publisherSeenCountBefore,
          publisher_matches_prior_version:
            contributor.publisherMatchesPriorVersion,
          maintainer_set_changed: contributor.maintainerSetChanged,
          new_maintainer_count: contributor.newMaintainerCount,
          removed_maintainer_count: contributor.removedMaintainerCount,
          maintainer_count: contributor.maintainerCount,
          has_install_scripts: contributor.hasInstallScripts,
          has_provenance: contributor.hasProvenance,
          has_trusted_publisher: contributor.hasTrustedPublisher,
          release_velocity_7d: contributor.releaseVelocity7d,
          release_velocity_30d: contributor.releaseVelocity30d,
          history_complete: contributor.historyComplete,
          raw_factors: contributor.rawFactors,
          last_scored_at: contributor.lastScoredAt,
        },
        last_pulled_at: contributor.lastPulledAt,
      };
    }),
    pagination: {
      total,
      offset,
      limit,
    },
  };
}
