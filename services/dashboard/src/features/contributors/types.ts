export interface ContributorRiskCounts {
  high: number;
  medium: number;
  low: number;
  clean: number;
}

export interface ContributorSummaryBase {
  computedAt: string;
  lastScoredAt: string | null;
  packages: {
    totalScanned: number;
    notScanned: number;
    byRisk: ContributorRiskCounts;
  };
  signals: {
    newMaintainerCount: number;
    firstTimePublisherCount: number;
    publisherChangeCount: number;
    installScriptsCount: number;
  };
}

export interface ProjectContributorSummary extends ContributorSummaryBase {
  projectId: string;
}

export interface TenantContributorProjectBreakdown {
  projectId: string;
  projectName: string;
  totalScanned: number;
  byRisk: ContributorRiskCounts;
}

export interface TenantContributorSummary extends ContributorSummaryBase {
  tenantId: string;
  byProject: TenantContributorProjectBreakdown[];
}

export interface ContributorPackageProject {
  id: string;
  name: string;
}

export interface ContributorPackage {
  ecosystem: string;
  name: string;
  version: string;
  versionPublishedAt: string | null;
  latestVersion: string | null;
  score: number;
  scoreTier: string;
  publisher: string | null;
  publisherSeenBeforePackage: boolean | null;
  publisherSeenCountBefore: number | null;
  publisherMatchesPriorVersion: boolean | null;
  maintainerSetChanged: boolean | null;
  newMaintainerCount: number | null;
  removedMaintainerCount: number | null;
  maintainerCount: number | null;
  hasInstallScripts: boolean | null;
  hasProvenance: boolean | null;
  hasTrustedPublisher: boolean | null;
  releaseVelocity7d: number | null;
  releaseVelocity30d: number | null;
  historyComplete: boolean | null;
  rawFactors: Record<string, number | null> | null;
  lastScoredAt: string | null;
  lastPulledAt: string | null;
  projects?: ContributorPackageProject[];
}

export interface ContributorPackagesResponse {
  packages: ContributorPackage[];
  pagination: {
    total: number;
    offset: number;
    limit: number;
  };
}

export interface ContributorPublisher {
  ecosystem: string;
  publisherName: string;
  packageCount: number;
  firstTimePublisherCount: number;
  continuityBreakCount: number;
  lastSeenAt: string | null;
}

export interface ContributorPublishersResponse {
  publishers: ContributorPublisher[];
  pagination: {
    total: number;
    offset: number;
    limit: number;
  };
}
