import { Code, ConnectError } from "@connectrpc/connect";
import { ServeMode, EventType } from "../gen/customs/v1/gateway_pb.js";

export const DECISION_ALLOW = 1;
export const DECISION_BLOCK = 2;

export function proxyAuthConnectError(
  reason: "unregistered_proxy" | "invalid_proxy_secret" | "invalid_proxy_token",
): ConnectError {
  return new ConnectError(reason, Code.Unauthenticated);
}

export function serveModeToString(mode: ServeMode): string | null {
  switch (mode) {
    case ServeMode.REDIRECT:
      return "SERVE_MODE_REDIRECT";
    case ServeMode.PULL:
      return "SERVE_MODE_PULL";
    default:
      return null;
  }
}

export function eventTypeToString(type: EventType): string {
  switch (type) {
    case EventType.METADATA:
      return "metadata";
    case EventType.ARTIFACT:
      return "artifact";
    case EventType.UPSTREAM_ERROR:
      return "upstream_error";
    default:
      return "artifact";
  }
}
