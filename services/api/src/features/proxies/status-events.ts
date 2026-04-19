import { db } from "../../db/index.js";
import { proxy_status_events } from "../../db/schema.js";

type ProxyStatusEventInsert = {
  tenantId: string;
  proxyId: string;
  proxyIp?: string | null;
  eventType: string;
  actorUserId?: string | null;
  detail?: string | null;
};

export async function insertProxyStatusEvent({
  tenantId,
  proxyId,
  proxyIp = null,
  eventType,
  actorUserId = null,
  detail = null,
}: ProxyStatusEventInsert): Promise<void> {
  await db.insert(proxy_status_events).values({
    tenant_id: tenantId,
    proxy_id: proxyId,
    proxy_ip: proxyIp,
    event_type: eventType,
    actor_user_id: actorUserId,
    detail,
  });
}
