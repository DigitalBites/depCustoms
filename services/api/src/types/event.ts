import type {
  Decision,
  ProxyStatusEventType,
  RequestEventSource,
  RequestEventType,
  ServeMode,
} from "@customs/shared-constants";

export type EventSourceType = RequestEventSource;
export type EventType = RequestEventType;
export type { ProxyStatusEventType };

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
  decision: Decision;
  reason: string | null;
  serve_mode: ServeMode | null;
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
