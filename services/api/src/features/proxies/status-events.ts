import { Code, ConnectError } from "@connectrpc/connect";
import {
  PROXY_STATUS_EVENT_TYPES,
  type ProxyStatusEventType,
} from "@customs/shared-constants";
import { db } from "../../db/index.js";
import { proxy_status_events } from "../../db/schema.js";

type ProxyStatusEventInsert = {
  tenantId: string;
  proxyId: string;
  proxyIp?: string | null;
  eventType: ProxyStatusEventType;
  actorUserId?: string | null;
  detail?: string | null;
};

export function assertProxyStatusEventType(
  eventType: string,
): asserts eventType is ProxyStatusEventType {
  if (!PROXY_STATUS_EVENT_TYPES.includes(eventType as ProxyStatusEventType)) {
    throw new ConnectError(
      `unknown proxy status event type: ${eventType || "<empty>"}`,
      Code.InvalidArgument,
    );
  }
}

export async function insertProxyStatusEvent({
  tenantId,
  proxyId,
  proxyIp = null,
  eventType,
  actorUserId = null,
  detail = null,
}: ProxyStatusEventInsert): Promise<void> {
  assertProxyStatusEventType(eventType);

  await db.insert(proxy_status_events).values({
    tenant_id: tenantId,
    proxy_id: proxyId,
    proxy_ip: proxyIp,
    event_type: eventType,
    actor_user_id: actorUserId,
    detail,
  });
}
