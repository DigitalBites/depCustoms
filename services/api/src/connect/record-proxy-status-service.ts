import { log } from "../logger.js";
import { insertProxyStatusEvent } from "../features/proxies/status-events.js";
import type { VerifiedProxyContext } from "./proxy-context.js";

export async function handleRecordProxyStatus(
  proxy: VerifiedProxyContext,
  eventType: string,
): Promise<void> {
  await insertProxyStatusEvent({
    tenantId: proxy.tenantId,
    proxyId: proxy.proxyId,
    proxyIp: proxy.proxyIp,
    eventType,
  });

  log.info("proxy_status_event", {
    event_type: eventType,
    proxy_id: proxy.proxyId,
    tenant_id: proxy.tenantId,
    proxy_ip: proxy.proxyIp,
  });
}
