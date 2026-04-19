import { db } from "../db/index.js";
import { proxy_metadata_cache_stats } from "../db/schema.js";
import { log } from "../logger.js";
import type { VerifiedProxyContext } from "./proxy-context.js";

type MetadataCacheStatsInput = {
  ecosystem: string;
  hits: number;
  misses: number;
  stale_hits: number;
  refreshes: number;
  parse_failures: number;
  store_failures: number;
  window_started_at: string;
  window_ended_at: string;
};

export async function handleRecordMetadataCacheStats(
  proxy: VerifiedProxyContext,
  msg: MetadataCacheStatsInput,
): Promise<void> {
  await db.insert(proxy_metadata_cache_stats).values({
    tenant_id: proxy.tenantId,
    proxy_id: proxy.proxyId,
    ecosystem: msg.ecosystem,
    hits: msg.hits,
    misses: msg.misses,
    stale_hits: msg.stale_hits,
    refreshes: msg.refreshes,
    parse_failures: msg.parse_failures,
    store_failures: msg.store_failures,
    window_started_at: new Date(msg.window_started_at),
    window_ended_at: new Date(msg.window_ended_at),
  });

  log.info("metadata_cache_stats_recorded", {
    proxy_id: proxy.proxyId,
    tenant_id: proxy.tenantId,
    ecosystem: msg.ecosystem,
    hits: msg.hits,
    misses: msg.misses,
    stale_hits: msg.stale_hits,
    refreshes: msg.refreshes,
    parse_failures: msg.parse_failures,
    store_failures: msg.store_failures,
    window_started_at: msg.window_started_at,
    window_ended_at: msg.window_ended_at,
  });
}
