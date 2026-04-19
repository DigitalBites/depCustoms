import { db } from "../../db/index.js";
import { mcp_audit_events } from "../../db/schema.js";
import { log, serializeError } from "../../logger.js";
import type { McpRequestContext } from "./context.js";

type RecordMcpAuditEventParams = {
  ctx: McpRequestContext;
  methodName: string;
  outcome: "success" | "error" | "unauthorized";
  target?: Record<string, unknown> | null;
  detail?: string | null;
};

export async function recordMcpAuditEvent(
  params: RecordMcpAuditEventParams,
): Promise<void> {
  const { ctx, methodName, outcome, target = null, detail = null } = params;

  await db.insert(mcp_audit_events).values({
    tenant_id: ctx.principal.tenantId,
    project_id: null,
    user_id: ctx.principal.userId,
    role: ctx.principal.role,
    client_name: ctx.principal.clientId,
    session_id: ctx.transportSessionId ?? ctx.principal.sessionId,
    method_name: methodName,
    target,
    outcome,
    trace_id: ctx.traceId,
    request_id: ctx.requestId,
    detail,
  });

  log.info("mcp_audit_event_recorded", {
    tenant_id: ctx.principal.tenantId,
    project_id: null,
    user_id: ctx.principal.userId,
    role: ctx.principal.role,
    client_name: ctx.principal.clientId,
    session_id: ctx.transportSessionId ?? ctx.principal.sessionId,
    method_name: methodName,
    outcome,
    trace_id: ctx.traceId,
    request_id: ctx.requestId,
    target,
    detail,
  });
}

export async function recordMcpAuditEventSafely(
  params: RecordMcpAuditEventParams,
): Promise<void> {
  try {
    await recordMcpAuditEvent(params);
  } catch (err) {
    log.error("mcp_audit_event_failed", {
      method_name: params.methodName,
      outcome: params.outcome,
      ...serializeError(err),
    });
  }
}
