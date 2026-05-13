import type {
  Decision,
  RequestEventSource,
  RequestEventType,
  ServeMode,
} from "@customs/shared-constants";

export interface EventRecord {
  id: string;
  tenant_id: string;
  project_id: string | null;
  proxy_id: string;
  ecosystem: string;
  package: string;
  version: string;
  decision: Decision;
  reason: string | null;
  source: RequestEventSource;
  event_type: RequestEventType;
  decision_cache: boolean | null;
  serve_mode: ServeMode | null;
  bytes_transferred: number | null;
  trace_id: string | null;
  span_id: string | null;
  request_id: string | null;
  project_token_id: string | null;
  client_ip: string | null;
  proxy_ip: string | null;
  requested_at: string;
  created_at: string;
  cve_severity: string | null;
  fix_version: string | null;
}

export interface EventMetrics {
  total: number;
  allowed: number;
  blocked: number;
  pulls: number;
  redirects: number;
  totalBytes: number;
}
