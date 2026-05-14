import type { PackageIntelligenceConnector } from "../types.js";

export const CONTRIBUTOR_CONNECTOR_ID = "contributor";

export interface ContributorManifestVersion {
  version: string;
  publishedAt: string;
  publisher: string | null;
  maintainers: string[];
  hasInstallScripts: boolean;
  hasAttestation: boolean;
  rawPayloadJson?: string | null;
}

export interface ContributorManifestEvent {
  ecosystem: string;
  package: string;
  extractedAt: string;
  fingerprint: string | null;
  packageMetadataFingerprint?: string | null;
  sliceFingerprint?: string | null;
  requestedVersion?: string | null;
  latestVersion: string | null;
  latestPublishedAt: string | null;
  historyComplete: boolean;
  oldestIncludedPublishedAt: string | null;
  versions: ContributorManifestVersion[];
}

export function isContributorConnectorRegistered(
  connector: PackageIntelligenceConnector,
): boolean {
  return connector.id === CONTRIBUTOR_CONNECTOR_ID;
}
