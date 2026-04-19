import type { VerifiedProxyContext } from "./proxy-context.js";
import { log } from "../logger.js";
import { persistPackageLatestMetadata } from "../features/package-freshness/service.js";

type PackageLatestMetadataInput = {
  ecosystem: string;
  package: string;
  latest_version: string;
  latest_published_at: string | null;
  observed_at: string;
  cache_status: string;
};

export async function handleRecordPackageLatestMetadata(
  proxy: VerifiedProxyContext,
  msg: PackageLatestMetadataInput,
): Promise<void> {
  await persistPackageLatestMetadata(msg);

  log.info("package_latest_metadata_recorded", {
    proxy_id: proxy.proxyId,
    tenant_id: proxy.tenantId,
    ecosystem: msg.ecosystem,
    package: msg.package,
    latest_version: msg.latest_version,
    latest_published_at: msg.latest_published_at,
    observed_at: msg.observed_at,
    cache_status: msg.cache_status,
  });
}
