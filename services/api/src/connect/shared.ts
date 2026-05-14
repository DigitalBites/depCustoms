import { Code, ConnectError } from "@connectrpc/connect";
import {
  METADATA_CACHE_STATUS,
  REQUEST_EVENT_TYPE,
  SERVE_MODE,
} from "@customs/shared-constants";
import type { RequestEventType, ServeMode as SharedServeMode } from "@customs/shared-constants";
import {
  ServeMode,
  EventType,
  MetadataCacheStatus,
} from "../gen/customs/v1/gateway_pb.js";

export const DECISION_ALLOW = 1;
export const DECISION_BLOCK = 2;

export function proxyAuthConnectError(
  reason: "unregistered_proxy" | "invalid_proxy_secret" | "invalid_proxy_token",
): ConnectError {
  return new ConnectError(reason, Code.Unauthenticated);
}

export function serveModeToString(mode: ServeMode): SharedServeMode | null {
  switch (mode) {
    case ServeMode.REDIRECT:
      return SERVE_MODE.REDIRECT;
    case ServeMode.PULL:
      return SERVE_MODE.PULL;
    default:
      return null;
  }
}

export function eventTypeToString(type: EventType): RequestEventType {
  switch (type) {
    case EventType.METADATA:
      return REQUEST_EVENT_TYPE.METADATA;
    case EventType.ARTIFACT:
      return REQUEST_EVENT_TYPE.ARTIFACT;
    case EventType.UPSTREAM_ERROR:
      return REQUEST_EVENT_TYPE.UPSTREAM_ERROR;
    default:
      throw new ConnectError("unknown request event type", Code.InvalidArgument);
  }
}

export function metadataCacheStatusToString(status: MetadataCacheStatus): string {
  switch (status) {
    case MetadataCacheStatus.HIT:
      return METADATA_CACHE_STATUS.HIT;
    case MetadataCacheStatus.MISS:
      return METADATA_CACHE_STATUS.MISS;
    case MetadataCacheStatus.STALE:
      return METADATA_CACHE_STATUS.STALE;
    case MetadataCacheStatus.REFRESH:
      return METADATA_CACHE_STATUS.REFRESH;
    default:
      return "unspecified";
  }
}
