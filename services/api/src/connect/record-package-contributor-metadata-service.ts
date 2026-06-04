import type { VerifiedProxyContext } from "./proxy-context.js";
import { getConnectors } from "../connectors/runtime.js";
import type { ContributorManifestEvent } from "../connectors/contributor/types.js";
import { db } from "../db/index.js";
import { log, serializeError } from "../logger.js";
import {
  contributorIngestionConfigFromConnectors,
  ingestContributorMetadata,
} from "../features/contributors/ingestion-service.js";
import type { DB } from "../db/index.js";

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

type ContributorMetadataIngestJob = {
  key: string;
  proxy: VerifiedProxyContext;
  event: ContributorManifestEvent;
  database: DB;
  config: NonNullable<ReturnType<typeof contributorIngestionConfigFromConnectors>>;
};

const CONTRIBUTOR_METADATA_INGEST_CONCURRENCY = 1;
const contributorMetadataIngestQueue = new Map<
  string,
  ContributorMetadataIngestJob
>();
const contributorMetadataIngestInFlight = new Set<string>();
const contributorMetadataIdleResolvers: Array<() => void> = [];
let activeContributorMetadataIngests = 0;

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

  enqueueContributorMetadataIngest({
    key: contributorMetadataIngestKey(event),
    proxy,
    event,
    database: db,
    config,
  });
}

function enqueueContributorMetadataIngest(
  job: ContributorMetadataIngestJob,
): void {
  if (
    contributorMetadataIngestInFlight.has(job.key) ||
    contributorMetadataIngestQueue.has(job.key)
  ) {
    log.debug("package_contributor_metadata_ingest_deduped", {
      proxy_id: job.proxy.proxyId,
      tenant_id: job.proxy.tenantId,
      ecosystem: job.event.ecosystem,
      package: job.event.package,
      version_count: job.event.versions.length,
      queue_depth: contributorMetadataIngestQueue.size,
    });
    return;
  }

  contributorMetadataIngestQueue.set(job.key, job);
  log.debug("package_contributor_metadata_ingest_queued", {
    proxy_id: job.proxy.proxyId,
    tenant_id: job.proxy.tenantId,
    ecosystem: job.event.ecosystem,
    package: job.event.package,
    version_count: job.event.versions.length,
    queue_depth: contributorMetadataIngestQueue.size,
  });
  drainContributorMetadataIngestQueue();
}

function drainContributorMetadataIngestQueue(): void {
  while (
    activeContributorMetadataIngests <
    CONTRIBUTOR_METADATA_INGEST_CONCURRENCY
  ) {
    const next = contributorMetadataIngestQueue.entries().next();
    if (next.done) break;

    const [key, job] = next.value;
    contributorMetadataIngestQueue.delete(key);
    contributorMetadataIngestInFlight.add(key);
    activeContributorMetadataIngests++;

    void runContributorMetadataIngestJob(job).finally(() => {
      activeContributorMetadataIngests--;
      contributorMetadataIngestInFlight.delete(key);
      drainContributorMetadataIngestQueue();
      resolveContributorMetadataIdleWaiters();
    });
  }

  resolveContributorMetadataIdleWaiters();
}

async function runContributorMetadataIngestJob(
  job: ContributorMetadataIngestJob,
): Promise<void> {
  try {
    await ingestContributorMetadata({
      event: job.event,
      database: job.database,
      config: job.config,
    });
    log.debug("package_contributor_metadata_ingested", {
      proxy_id: job.proxy.proxyId,
      tenant_id: job.proxy.tenantId,
      ecosystem: job.event.ecosystem,
      package: job.event.package,
      version_count: job.event.versions.length,
    });
  } catch (err) {
    log.warn("package_contributor_metadata_ingest_failed", {
      proxy_id: job.proxy.proxyId,
      tenant_id: job.proxy.tenantId,
      ecosystem: job.event.ecosystem,
      package: job.event.package,
      ...serializeError(err),
    });
  }
}

function contributorMetadataIngestKey(event: ContributorManifestEvent): string {
  const fingerprint = event.packageMetadataFingerprint ?? event.fingerprint;
  return [
    event.ecosystem,
    event.package,
    fingerprint ??
      [
        event.extractedAt,
        event.latestVersion ?? "",
        event.latestPublishedAt ?? "",
        event.versions.length,
      ].join(":"),
  ].join("|");
}

function contributorMetadataIngestIsIdle(): boolean {
  return (
    activeContributorMetadataIngests === 0 &&
    contributorMetadataIngestQueue.size === 0
  );
}

function resolveContributorMetadataIdleWaiters(): void {
  if (!contributorMetadataIngestIsIdle()) return;

  const resolvers = contributorMetadataIdleResolvers.splice(0);
  for (const resolve of resolvers) {
    resolve();
  }
}

export async function waitForContributorMetadataIngestQueueForTests(): Promise<void> {
  if (contributorMetadataIngestIsIdle()) return;

  await new Promise<void>((resolve) => {
    contributorMetadataIdleResolvers.push(resolve);
  });
}
