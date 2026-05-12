import type { VerifiedProxyContext } from "./proxy-context.js";
import { getConnectors } from "../connectors/runtime.js";
import type { ContributorManifestEvent } from "../connectors/contributor/types.js";
import { db } from "../db/index.js";
import { log, serializeError } from "../logger.js";
import {
  contributorIngestionConfigFromConnectors,
  ingestContributorMetadata,
} from "../features/contributors/ingestion-service.js";

export interface PackageContributorVersionInput {
  version: string;
  published_at: string;
  publisher: string | null;
  maintainers: string[];
  has_install_scripts: boolean;
  has_attestation: boolean;
  raw_payload_json?: string | null;
}

export interface PackageContributorMetadataInput {
  ecosystem: string;
  package: string;
  extracted_at: string;
  fingerprint: string | null;
  latest_version: string | null;
  latest_published_at: string | null;
  history_complete: boolean;
  oldest_included_published_at: string | null;
  versions: PackageContributorVersionInput[];
}

export async function handleRecordPackageContributorMetadata(
  proxy: VerifiedProxyContext,
  msg: PackageContributorMetadataInput,
): Promise<void> {
  log.debug("package_contributor_metadata_received", {
    proxy_id: proxy.proxyId,
    tenant_id: proxy.tenantId,
    ecosystem: msg.ecosystem,
    package: msg.package,
    version_count: msg.versions.length,
  });

  const config = contributorIngestionConfigFromConnectors(getConnectors());
  if (!config) {
    return;
  }

  const event: ContributorManifestEvent = {
    ecosystem: msg.ecosystem,
    package: msg.package,
    extractedAt: msg.extracted_at,
    fingerprint: msg.fingerprint,
    latestVersion: msg.latest_version,
    latestPublishedAt: msg.latest_published_at,
    historyComplete: msg.history_complete,
    oldestIncludedPublishedAt: msg.oldest_included_published_at,
    versions: msg.versions.map((v) => ({
      version: v.version,
      publishedAt: v.published_at,
      publisher: v.publisher || null,
      maintainers: v.maintainers,
      hasInstallScripts: v.has_install_scripts,
      hasAttestation: v.has_attestation,
      rawPayloadJson: v.raw_payload_json,
    })),
  };

  try {
    await ingestContributorMetadata({ event, database: db, config });
  } catch (err) {
    log.warn("package_contributor_metadata_ingest_failed", {
      proxy_id: proxy.proxyId,
      tenant_id: proxy.tenantId,
      ecosystem: msg.ecosystem,
      package: msg.package,
      version_count: msg.versions.length,
      ...serializeError(err),
    });
  }
}
