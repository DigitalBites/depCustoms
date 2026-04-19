export interface OsvSummary {
  computedAt: string;
  lastSyncedAt: string | null;
  packages: {
    total: number;
    unscanned: number;
    clean: number;
    vulnerable: number;
    bySeverity: { critical: number; high: number; medium: number; low: number };
  };
  fixes: {
    available: number;
    availableNotApplied: number;
  };
  exploitability: {
    networkExploitable: number;
  };
  oldestUnresolvedAdvisory: string | null;
  oldestUnresolvedDays: number | null;
}

export interface FindingDisposition {
  id: string;
  findingId: string;
  severity: string;
  status: string;
  statusNote: string | null;
}

export interface VulnDetail {
  findingId: string;
  severity: string;
  title: string | null;
  publishedAt: string | null;
  daysSincePublished: number | null;
  attributes: Record<string, unknown>;
  disposition: FindingDisposition | null;
}

export interface OsvPackageProject {
  id: string;
  name: string;
}

export interface OsvPackage {
  ecosystem: string;
  name: string;
  version: string;
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
  findings: FindingDisposition[];
  openViolationCount: number;
  projects?: OsvPackageProject[];
  vulns: VulnDetail[];
}

export interface OsvPackagesResponse {
  packages: OsvPackage[];
  pagination: {
    total: number;
    offset: number;
    limit: number;
  };
}

export interface OsvPackagesPanelProps {
  projectId?: string;
  showSummaryCards?: boolean;
  onViolationClick?: (entityId: string) => void;
  controlledData?: {
    summary: OsvSummary | null;
    packages: OsvPackage[];
    total: number;
    offset: number;
    loading: boolean;
    loadingMore: boolean;
    error: string | null;
    reload: () => Promise<void>;
    loadMore: () => Promise<void>;
  };
}

export interface ContributorFindingSummary {
  status: "ready" | "unavailable";
  hasFinding: boolean;
  tier: "NONE" | "LOW" | "MEDIUM" | "HIGH" | null;
  score: number | null;
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
}

export interface UnifiedFindingPackage {
  ecosystem: string;
  name: string;
  version: string;
  versionPublishedAt: string | null;
  lastPulledAt: string | null;
  openViolationCount: number;
  projects?: OsvPackageProject[];
  osv: {
    hasFindings: boolean;
    highestSeverity: string;
    vulnCount: number;
    fixAvailable: boolean;
    bestFixVersion: string | null;
    latestVersion: string | null;
    latestVersionPublishedAt: string | null;
    networkExploitable: boolean;
    findingStatus: string | null;
    findings: FindingDisposition[];
    vulns: VulnDetail[];
  };
  contributor: ContributorFindingSummary | null;
}

export interface UnifiedFindingPackagesResponse {
  packages: UnifiedFindingPackage[];
  pagination: {
    total: number;
    offset: number;
    limit: number;
  };
}
