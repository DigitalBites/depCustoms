type IsoDateValue = Date | string | null | undefined;

type PackageDisposition = {
  connectorKey?: string;
  findingId: string;
  status: string;
};

type IntelligenceDisposition = {
  id: string;
  connectorKey?: string;
  findingId: string;
  severity: string;
  status: string;
  statusNote: string | null;
};

type OsvFinding = {
  findingId: string;
  severity: string;
  title: string | null;
  publishedAt: Date | null;
  attributes: unknown;
};

type FindingRoutePackageRow = {
  package_id?: string;
  package_version_id?: string;
  ecosystem: string;
  name: string;
  version: string;
  version_published_at: IsoDateValue;
  last_pulled_at: IsoDateValue;
  latest_version: string | null;
  latest_version_published_at: IsoDateValue;
  osv_max_severity: string | null;
  osv_vuln_count: number | string | null;
  osv_fix_available: boolean | null;
  osv_best_fix_version: string | null;
  contributor_cache_id?: string | null;
  contributor_tier?: string | null;
  contributor_score?: number | string | null;
  publisher?: string | null;
  publisher_seen_before_package?: boolean | null;
  publisher_seen_count_before?: number | string | null;
  publisher_matches_prior_version?: boolean | null;
  maintainer_set_changed?: boolean | null;
  new_maintainer_count?: number | string | null;
  removed_maintainer_count?: number | string | null;
  maintainer_count?: number | string | null;
  has_install_scripts?: boolean | null;
  has_provenance?: boolean | null;
  has_trusted_publisher?: boolean | null;
  release_velocity_7d?: number | string | null;
  release_velocity_30d?: number | string | null;
  history_complete?: boolean | null;
  contributor_raw_factors?: Record<string, number | null> | null;
  contributor_last_scored_at?: IsoDateValue;
  intelligence_cache_id?: string | null;
  intelligence_nearest_match?: string | null;
  intelligence_recommended_action?: string | null;
  intelligence_confidence?: string | null;
  intelligence_match_quality?: string | null;
  intelligence_candidate_trust?: string | null;
  intelligence_llm_verdict?: string | null;
  intelligence_semantic_score?: number | string | null;
  intelligence_lexical_similarity_score?: number | string | null;
};

type ContributorPackageRow = {
  package_id?: string;
  ecosystem: string;
  name: string;
  version: string;
  version_published_at: IsoDateValue;
  latest_version: string | null;
  score: number | string;
  score_tier: string;
  publisher: string | null;
  publisher_seen_before_package: boolean | null;
  publisher_seen_count_before: number | string | null;
  publisher_matches_prior_version: boolean | null;
  maintainer_set_changed: boolean | null;
  new_maintainer_count: number | string | null;
  removed_maintainer_count: number | string | null;
  maintainer_count: number | string | null;
  has_install_scripts: boolean | null;
  has_provenance: boolean | null;
  has_trusted_publisher: boolean | null;
  release_velocity_7d: number | string | null;
  release_velocity_30d: number | string | null;
  history_complete: boolean | null;
  raw_factors: Record<string, number | null> | null;
  last_scored_at: IsoDateValue;
  last_pulled_at: IsoDateValue;
};

type OsvPackageBase = {
  packageId?: string;
  packageVersionId?: string;
  ecosystem: string;
  name: string;
  version: string;
  versionPublishedAt: IsoDateValue;
  osvMaxSeverity: string;
  osvFindingCount: number | string;
  osvFixAvailable: boolean;
  osvBestFixVersion: string | null;
  latestVersion: string | null;
  latestVersionPublishedAt: IsoDateValue;
  lastPulledAt: IsoDateValue;
};

type ContributorSummaryRow = {
  total_scanned: number | string | null;
  not_scanned_count: number | string | null;
  high_risk_count: number | string | null;
  medium_risk_count: number | string | null;
  low_risk_count: number | string | null;
  clean_count: number | string | null;
  new_maintainer_count: number | string | null;
  first_time_publisher_count: number | string | null;
  publisher_change_count: number | string | null;
  install_scripts_count: number | string | null;
  last_scored_at: IsoDateValue;
};

type TenantContributorProjectRow = {
  project_id: string;
  project_name: string;
  total_scanned: number | string | null;
  high_risk_count: number | string | null;
  medium_risk_count: number | string | null;
  low_risk_count: number | string | null;
  clean_count: number | string | null;
};

export function toIsoString(value: IsoDateValue): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toPublishedFinding(
  finding: OsvFinding,
  packageDispositions: PackageDisposition[],
  nowMs: number,
) {
  return {
    findingId: finding.findingId,
    severity: finding.severity,
    title: finding.title ?? null,
    publishedAt: finding.publishedAt?.toISOString() ?? null,
    daysSincePublished: finding.publishedAt
      ? Math.floor((nowMs - finding.publishedAt.getTime()) / 86_400_000)
      : null,
    attributes: finding.attributes,
    disposition:
      packageDispositions.find(
        (item) => item.findingId === finding.findingId,
      ) ?? null,
  };
}

function buildFindingStatus(
  packageDispositions: PackageDisposition[],
): string | null {
  if (packageDispositions.length === 0) return null;
  if (packageDispositions.some((item) => item.status === "open")) return "open";
  if (packageDispositions.every((item) => item.status === "suppressed")) {
    return "suppressed";
  }
  return "resolved";
}

export function buildOsvPackageResponse(input: {
  pkg: OsvPackageBase;
  vulns: OsvFinding[];
  packageDispositions?: PackageDisposition[];
  openViolationCount?: number;
  projects?: { id: string; name: string }[];
}): {
  packageId: string | null;
  packageVersionId: string | null;
  ecosystem: string;
  name: string;
  version: string;
  displayName: string;
  versionPublishedAt: string | null;
  maxSeverity: string;
  vulnCount: number;
  fixAvailable: boolean;
  bestFixVersion: string | null;
  latestVersion: string | null;
  latestVersionPublishedAt: string | null;
  networkExploitable: boolean;
  lastPulledAt: string | null;
  findingStatus: string | null;
  findings: PackageDisposition[];
  openViolationCount: number;
  vulns: Array<ReturnType<typeof toPublishedFinding>>;
  projects?: { id: string; name: string }[];
} {
  const packageDispositions = input.packageDispositions ?? [];
  const nowMs = Date.now();

  return {
    packageId: input.pkg.packageId ?? null,
    packageVersionId: input.pkg.packageVersionId ?? null,
    ecosystem: input.pkg.ecosystem,
    name: input.pkg.name,
    version: input.pkg.version,
    displayName: `${input.pkg.ecosystem}:${input.pkg.name}@${input.pkg.version}`,
    versionPublishedAt: toIsoString(input.pkg.versionPublishedAt),
    maxSeverity: input.pkg.osvMaxSeverity,
    vulnCount: Number(input.pkg.osvFindingCount),
    fixAvailable: input.pkg.osvFixAvailable,
    bestFixVersion: input.pkg.osvBestFixVersion,
    latestVersion: input.pkg.latestVersion,
    latestVersionPublishedAt: toIsoString(input.pkg.latestVersionPublishedAt),
    networkExploitable: input.vulns.some(
      (finding) =>
        (finding.attributes as Record<string, unknown>)?.attack_vector ===
        "NETWORK",
    ),
    lastPulledAt: toIsoString(input.pkg.lastPulledAt),
    findingStatus: buildFindingStatus(packageDispositions),
    findings: packageDispositions,
    openViolationCount: input.openViolationCount ?? 0,
    vulns: input.vulns.map((finding) =>
      toPublishedFinding(finding, packageDispositions, nowMs),
    ),
    ...(input.projects ? { projects: input.projects } : {}),
  };
}

export function buildContributorPackageResponse(
  pkg: ContributorPackageRow,
  projects?: { id: string; name: string }[],
) {
  return {
    ecosystem: pkg.ecosystem,
    name: pkg.name,
    version: pkg.version,
    versionPublishedAt: toIsoString(pkg.version_published_at),
    latestVersion: pkg.latest_version ?? null,
    score: Number(pkg.score),
    scoreTier: pkg.score_tier,
    publisher: pkg.publisher ?? null,
    publisherSeenBeforePackage: pkg.publisher_seen_before_package ?? null,
    publisherSeenCountBefore:
      pkg.publisher_seen_count_before !== null
        ? Number(pkg.publisher_seen_count_before)
        : null,
    publisherMatchesPriorVersion: pkg.publisher_matches_prior_version ?? null,
    maintainerSetChanged: pkg.maintainer_set_changed ?? null,
    newMaintainerCount:
      pkg.new_maintainer_count !== null
        ? Number(pkg.new_maintainer_count)
        : null,
    removedMaintainerCount:
      pkg.removed_maintainer_count !== null
        ? Number(pkg.removed_maintainer_count)
        : null,
    maintainerCount:
      pkg.maintainer_count !== null ? Number(pkg.maintainer_count) : null,
    hasInstallScripts: pkg.has_install_scripts ?? null,
    hasProvenance: pkg.has_provenance ?? null,
    hasTrustedPublisher: pkg.has_trusted_publisher ?? null,
    releaseVelocity7d:
      pkg.release_velocity_7d !== null ? Number(pkg.release_velocity_7d) : null,
    releaseVelocity30d:
      pkg.release_velocity_30d !== null
        ? Number(pkg.release_velocity_30d)
        : null,
    historyComplete: pkg.history_complete ?? null,
    rawFactors: pkg.raw_factors ?? null,
    lastScoredAt: toIsoString(pkg.last_scored_at),
    lastPulledAt: toIsoString(pkg.last_pulled_at),
    ...(projects ? { projects } : {}),
  };
}

export function buildContributorContextResponse(
  pkg: FindingRoutePackageRow,
  includeContributor: boolean,
) {
  if (!includeContributor) {
    return null;
  }

  return {
    status: pkg.contributor_cache_id ? "ready" : "unavailable",
    hasFinding:
      pkg.contributor_cache_id !== null &&
      pkg.contributor_cache_id !== undefined &&
      pkg.contributor_tier !== null &&
      pkg.contributor_tier !== "NONE",
    tier: pkg.contributor_cache_id ? (pkg.contributor_tier ?? "NONE") : null,
    score:
      pkg.contributor_cache_id !== null &&
      pkg.contributor_cache_id !== undefined
        ? Number(pkg.contributor_score ?? 0)
        : null,
    publisher: pkg.publisher ?? null,
    publisherSeenBeforePackage: pkg.publisher_seen_before_package ?? null,
    publisherSeenCountBefore:
      pkg.publisher_seen_count_before !== null &&
      pkg.publisher_seen_count_before !== undefined
        ? Number(pkg.publisher_seen_count_before)
        : null,
    publisherMatchesPriorVersion: pkg.publisher_matches_prior_version ?? null,
    maintainerSetChanged: pkg.maintainer_set_changed ?? null,
    newMaintainerCount:
      pkg.new_maintainer_count !== null &&
      pkg.new_maintainer_count !== undefined
        ? Number(pkg.new_maintainer_count)
        : null,
    removedMaintainerCount:
      pkg.removed_maintainer_count !== null &&
      pkg.removed_maintainer_count !== undefined
        ? Number(pkg.removed_maintainer_count)
        : null,
    maintainerCount:
      pkg.maintainer_count !== null && pkg.maintainer_count !== undefined
        ? Number(pkg.maintainer_count)
        : null,
    hasInstallScripts: pkg.has_install_scripts ?? null,
    hasProvenance: pkg.has_provenance ?? null,
    hasTrustedPublisher: pkg.has_trusted_publisher ?? null,
    releaseVelocity7d:
      pkg.release_velocity_7d !== null && pkg.release_velocity_7d !== undefined
        ? Number(pkg.release_velocity_7d)
        : null,
    releaseVelocity30d:
      pkg.release_velocity_30d !== null &&
      pkg.release_velocity_30d !== undefined
        ? Number(pkg.release_velocity_30d)
        : null,
    historyComplete: pkg.history_complete ?? null,
    rawFactors: pkg.contributor_raw_factors ?? null,
    lastScoredAt: toIsoString(pkg.contributor_last_scored_at),
  };
}

export function buildFindingPackageResponse(input: {
  pkg: FindingRoutePackageRow;
  vulns: OsvFinding[];
  includeContributor: boolean;
  openViolationCount: number;
  packageDispositions?: IntelligenceDisposition[];
  projects?: { id: string; name: string }[];
}) {
  const osvDispositions = (input.packageDispositions ?? []).filter(
    (item) => (item.connectorKey ?? "osv") === "osv",
  );
  const intelligenceDispositions = (input.packageDispositions ?? []).filter(
    (item) => item.connectorKey === "intelligence",
  );

  return {
    packageId: input.pkg.package_id ?? null,
    packageVersionId: input.pkg.package_version_id ?? null,
    ecosystem: input.pkg.ecosystem,
    name: input.pkg.name,
    version: input.pkg.version,
    displayName: `${input.pkg.ecosystem}:${input.pkg.name}@${input.pkg.version}`,
    versionPublishedAt: toIsoString(input.pkg.version_published_at),
    lastPulledAt: toIsoString(input.pkg.last_pulled_at),
    openViolationCount: input.openViolationCount,
    ...(input.projects ? { projects: input.projects } : {}),
    osv: {
      hasFindings:
        input.pkg.osv_max_severity !== null &&
        input.pkg.osv_max_severity !== "NONE",
      highestSeverity: input.pkg.osv_max_severity ?? "NONE",
      vulnCount: Number(input.pkg.osv_vuln_count ?? 0),
      fixAvailable: input.pkg.osv_fix_available ?? false,
      bestFixVersion: input.pkg.osv_best_fix_version ?? null,
      latestVersion: input.pkg.latest_version ?? null,
      latestVersionPublishedAt: toIsoString(
        input.pkg.latest_version_published_at,
      ),
      networkExploitable: input.vulns.some(
        (finding) =>
          (finding.attributes as Record<string, unknown>)?.attack_vector ===
          "NETWORK",
      ),
      findingStatus: buildFindingStatus(osvDispositions),
      findings: osvDispositions,
      vulns: input.vulns.map((finding) =>
        toPublishedFinding(
          finding,
          osvDispositions,
          Date.now(),
        ),
      ),
    },
    intelligence:
      input.pkg.intelligence_cache_id !== null &&
      input.pkg.intelligence_cache_id !== undefined
        ? {
            hasFinding: intelligenceDispositions.length > 0,
            nearestMatch: input.pkg.intelligence_nearest_match ?? null,
            recommendedAction:
              input.pkg.intelligence_recommended_action ?? "allow",
            confidence: input.pkg.intelligence_confidence ?? "low",
            matchQuality: input.pkg.intelligence_match_quality ?? "weak",
            candidateTrust: input.pkg.intelligence_candidate_trust ?? null,
            llmVerdict: input.pkg.intelligence_llm_verdict ?? null,
            semanticScore:
              input.pkg.intelligence_semantic_score !== null &&
              input.pkg.intelligence_semantic_score !== undefined
                ? Number(input.pkg.intelligence_semantic_score)
                : null,
            lexicalSimilarityScore:
              input.pkg.intelligence_lexical_similarity_score !== null &&
              input.pkg.intelligence_lexical_similarity_score !== undefined
                ? Number(input.pkg.intelligence_lexical_similarity_score)
                : null,
            findingStatus: buildFindingStatus(intelligenceDispositions),
            findings: intelligenceDispositions,
          }
        : null,
    contributor: buildContributorContextResponse(
      input.pkg,
      input.includeContributor,
    ),
  };
}

export function buildContributorSummaryResponse(
  summary: ContributorSummaryRow,
  computedAt: string,
  byProject: TenantContributorProjectRow[] = [],
) {
  const totalScanned = Number(summary.total_scanned ?? 0);
  const notScanned = Number(summary.not_scanned_count ?? 0);

  return {
    computedAt,
    lastScoredAt: toIsoString(summary.last_scored_at),
    packages: {
      totalScanned,
      notScanned,
      byRisk: {
        high: Number(summary.high_risk_count ?? 0),
        medium: Number(summary.medium_risk_count ?? 0),
        low: Number(summary.low_risk_count ?? 0),
        clean: Number(summary.clean_count ?? 0),
      },
    },
    signals: {
      newMaintainerCount: Number(summary.new_maintainer_count ?? 0),
      firstTimePublisherCount: Number(summary.first_time_publisher_count ?? 0),
      publisherChangeCount: Number(summary.publisher_change_count ?? 0),
      installScriptsCount: Number(summary.install_scripts_count ?? 0),
    },
    ...(byProject.length > 0
      ? {
          byProject: byProject.map((row) => ({
            projectId: row.project_id,
            projectName: row.project_name,
            totalScanned: Number(row.total_scanned ?? 0),
            byRisk: {
              high: Number(row.high_risk_count ?? 0),
              medium: Number(row.medium_risk_count ?? 0),
              low: Number(row.low_risk_count ?? 0),
              clean: Number(row.clean_count ?? 0),
            },
          })),
        }
      : {}),
  };
}
