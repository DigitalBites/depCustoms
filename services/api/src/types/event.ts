// Canonical event types shared across REST responses, SSE stream messages,
// and the in-memory fan-out payload. Using one type everywhere prevents the
// REST and SSE paths from silently diverging.

export type EventSourceType = "proxy" | "policy_engine";

export type EventType =
  | "metadata" // proxy: version list / package info request
  | "artifact" // proxy: artifact download (or fail-closed block)
  | "upstream_error" // proxy: ALLOW but upstream registry unreachable
  | "proxy_request"; // policy_engine: policy decision at Check RPC time

export type ProxyStatusEventType =
  | "proxy_service_running"
  | "proxy_service_stopped"
  | "control_plane_unavailable"
  | "control_plane_available"
  | "token_exchange_attempt"
  | "token_issued"
  | "token_exchange_failed"
  | "proxy_disabled"
  | "proxy_enabled"
  | "secret_rotated"
  | "proxy_revoked";

// Request events — written to the `events` table.
export interface EventPayload {
  id: string; // UUID
  tenant_id: string;
  project_id: string | null;
  source: EventSourceType;
  event_type: EventType;
  decision_cache: boolean | null; // null for policy_engine rows
  proxy_id: string;
  ecosystem: string;
  package: string;
  version: string;
  decision: string; // 'allow' | 'block'
  reason: string | null;
  serve_mode: string | null; // 'SERVE_MODE_REDIRECT' | 'SERVE_MODE_PULL' | null
  bytes_transferred: number | null;
  trace_id: string | null;
  span_id: string | null;
  request_id: string | null;
  project_token_id: string | null;
  client_ip: string | null;
  proxy_ip: string | null;
  requested_at: string; // ISO 8601 UTC
  created_at: string; // ISO 8601 UTC
  // CVE enrichment — populated when reason='cve_threshold', null otherwise
  cve_severity: string | null;
  fix_version: string | null;
}

// Status events — written to the `proxy_status_events` table.
export interface ProxyStatusEventPayload {
  id: string;
  tenant_id: string;
  proxy_id: string;
  proxy_ip: string | null;
  event_type: ProxyStatusEventType;
  actor_user_id: string | null;
  detail: string | null;
  created_at: string; // ISO 8601 UTC
}
