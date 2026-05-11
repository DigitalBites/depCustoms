import type { DB } from "../../db/index.js";
import type { PackageIntelligenceConnector } from "../types.js";

export const CONTRIBUTOR_METADATA_INGESTION_KIND =
  "npm_contributor_history";

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

export interface ContributorMetadataIngestor
  extends PackageIntelligenceConnector {
  readonly metadataIngestionKind: typeof CONTRIBUTOR_METADATA_INGESTION_KIND;
  processContributorMetadata(
    event: ContributorManifestEvent,
    eventDb: DB,
  ): Promise<void>;
}

export function isContributorMetadataIngestor(
  connector: PackageIntelligenceConnector,
): connector is ContributorMetadataIngestor {
  const candidate = connector as Partial<ContributorMetadataIngestor>;
  return (
    candidate.metadataIngestionKind === CONTRIBUTOR_METADATA_INGESTION_KIND &&
    typeof candidate.processContributorMetadata === "function"
  );
}
