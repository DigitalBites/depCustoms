import type { EventPayload } from "../../types/event.js";

export const CONNECTED_EVENT = `event: connected\ndata: {}\n\n`;
export const AUTH_EXPIRED_EVENT = `event: auth_expired\ndata: {}\n\n`;
export const PING_EVENT = `: ping\n\n`;

type EventRow = {
  id: string;
  tenant_id: string;
  project_id: string | null;
  proxy_id: string;
  ecosystem: string;
  package: string;
  version: string;
  decision: string;
  reason: string | null;
  source: string;
  event_type: string;
  decision_cache: boolean | null;
  trace_id: string | null;
  span_id: string | null;
  request_id: string | null;
  serve_mode: string | null;
  bytes_transferred: number | null;
  project_token_id: string | null;
  client_ip: string | null;
  proxy_ip: string | null;
  requested_at: Date;
  created_at: Date;
  cve_severity?: string | null;
  fix_version?: string | null;
};

export function formatSSEEvent(event: EventPayload): string {
  return `event: message\nid: ${event.created_at}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function rowToPayload(row: EventRow): EventPayload {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    source: row.source as EventPayload["source"],
    event_type: row.event_type as EventPayload["event_type"],
    decision_cache: row.decision_cache,
    proxy_id: row.proxy_id,
    ecosystem: row.ecosystem,
    package: row.package,
    version: row.version,
    decision: row.decision,
    reason: row.reason,
    serve_mode: row.serve_mode,
    bytes_transferred: row.bytes_transferred,
    trace_id: row.trace_id,
    span_id: row.span_id,
    request_id: row.request_id,
    project_token_id: row.project_token_id,
    client_ip: row.client_ip,
    proxy_ip: row.proxy_ip,
    requested_at: row.requested_at.toISOString(),
    created_at: row.created_at.toISOString(),
    cve_severity: row.cve_severity ?? null,
    fix_version: row.fix_version ?? null,
  };
}
