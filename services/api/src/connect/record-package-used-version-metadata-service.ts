import type { VerifiedProxyContext } from "./proxy-context.js";
import { log } from "../logger.js";
import { persistPackageUsedVersionMetadata } from "../features/package-freshness/service.js";

type PackageUsedVersionMetadataInput = {
  ecosystem: string;
  package: string;
  used_version: string;
  used_version_published_at: string | null;
  observed_at: string;
  cache_status: string;
  latest_version: string | null;
  latest_published_at: string | null;
};

export async function handleRecordPackageUsedVersionMetadata(
  proxy: VerifiedProxyContext,
  msg: PackageUsedVersionMetadataInput,
): Promise<void> {
  await persistPackageUsedVersionMetadata(msg);

  log.info("package_used_version_metadata_recorded", {
    proxy_id: proxy.proxyId,
    tenant_id: proxy.tenantId,
    ecosystem: msg.ecosystem,
    package: msg.package,
    used_version: msg.used_version,
    used_version_published_at: msg.used_version_published_at,
    observed_at: msg.observed_at,
    cache_status: msg.cache_status,
    latest_version: msg.latest_version,
    latest_published_at: msg.latest_published_at,
  });
}
