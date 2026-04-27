import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { errorJson } from "../../http/responses.js";
import {
  buildInitializeResult,
  getMcpProtocolVersion,
} from "./lifecycle-service.js";
import {
  JsonRpcRequestError,
  jsonRpcError,
  jsonRpcResult,
  parseJsonRpcRequest,
} from "./jsonrpc.js";
import { mcpToolRegistry } from "./tool-registry.js";
import {
  resolveMcpPrincipalFromAuthorizationHeader,
  McpAuthError,
} from "./auth/service.js";
import { oauthErrorResponse } from "./auth/http-errors.js";
import type { McpRequestContext } from "./context.js";
import { mcpTransportSessionService } from "./session-service.js";
import { bootstrapMcpConnection } from "./connection-service.js";
import { getMcpAvailability } from "./availability-service.js";
import { recordMcpAuditEventSafely } from "./audit.js";
import { registerMcpTools } from "./tools/register-tools.js";
import { McpToolExecutionError } from "./tool-registry.js";
import { listAccessibleMcpProjects } from "./services/project-access.js";

registerMcpTools();

const mcpTransportHeaderSchema = z.object({
  authorization: z.string().optional(),
  sessionId: z.string().max(255).optional(),
});

function parseMcpTransportHeaders(req: Request) {
  const parsed = mcpTransportHeaderSchema.safeParse({
    authorization: req.headers.get("Authorization") ?? undefined,
    sessionId: req.headers.get("mcp-session-id") ?? undefined,
  });

  return parsed.success ? parsed.data : null;
}

function buildRequestContext(
  principal: Awaited<
    ReturnType<typeof resolveMcpPrincipalFromAuthorizationHeader>
  >,
  req: Request,
  transportSessionId: string | null,
): McpRequestContext {
  return {
    principal,
    requestId: req.headers.get("x-request-id") ?? randomUUID(),
    traceId: req.headers.get("traceparent"),
    transportSessionId,
  };
}

export const mcpRouter = new Hono();

const connectionRequestSchema = z.object({
  tenant_id: z.string().uuid(),
  client_name: z.string().trim().min(1).max(100),
});
const availabilityQuerySchema = z.object({
  tenant_id: z.string().uuid(),
});

mcpRouter.get(
  "/v1/mcp/availability",
  authMiddleware,
  zValidator("query", availabilityQuerySchema),
  async (c) => {
    const query = c.req.valid("query");
    const result = await getMcpAvailability({
      tenantId: query.tenant_id,
      tenants: c.get("tenants"),
    });

    if (!result.ok) {
      return errorJson(
        c,
        result.status,
        result.code,
        result.message,
        result.detail ?? null,
      );
    }

    return c.json(result.body);
  },
);

mcpRouter.post(
  "/v1/mcp/connections",
  authMiddleware,
  zValidator("json", connectionRequestSchema),
  async (c) => {
    const body = c.req.valid("json");
    const result = await bootstrapMcpConnection({
      requestUrl: c.req.url,
      requestHeaders: c.req.raw.headers,
      tenantId: body.tenant_id,
      clientName: body.client_name,
      tenants: c.get("tenants"),
    });

    if (!result.ok) {
      return errorJson(
        c,
        result.status,
        result.code,
        result.message,
        result.detail ?? null,
      );
    }

    return c.json(result.body);
  },
);

mcpRouter.get("/api/mcp", async (c) => {
  try {
    const headers = parseMcpTransportHeaders(c.req.raw);
    if (!headers) {
      return errorJson(
        c,
        400,
        "BAD_REQUEST",
        "MCP transport headers are invalid",
      );
    }
    const principal = await resolveMcpPrincipalFromAuthorizationHeader(
      headers.authorization,
    );
    const transportSessionId = mcpTransportSessionService.resolveOrCreate(
      headers.sessionId,
    );
    const ctx = buildRequestContext(principal, c.req.raw, transportSessionId);

    await recordMcpAuditEventSafely({
      ctx,
      methodName: "stream.connect",
      outcome: "success",
    });

    return new Response(": connected\n\n", {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "mcp-session-id": transportSessionId,
        "mcp-protocol-version": getMcpProtocolVersion(),
      },
    });
  } catch (err) {
    if (err instanceof McpAuthError) {
      return oauthErrorResponse(c, err);
    }
    throw err;
  }
});

mcpRouter.post("/api/mcp", async (c) => {
  let ctx: McpRequestContext | null = null;
  let methodName = "unknown";

  try {
    const headers = parseMcpTransportHeaders(c.req.raw);
    if (!headers) {
      return errorJson(
        c,
        400,
        "BAD_REQUEST",
        "MCP transport headers are invalid",
      );
    }
    const principal = await resolveMcpPrincipalFromAuthorizationHeader(
      headers.authorization,
    );
    const transportSessionId = mcpTransportSessionService.resolveOrCreate(
      headers.sessionId,
    );
    ctx = buildRequestContext(principal, c.req.raw, transportSessionId);

    const body: unknown = await c.req.json();
    const request = parseJsonRpcRequest(body);
    methodName = request.method;

    if (request.method === "initialize") {
      const accessibleProjects = await listAccessibleMcpProjects(principal);
      const defaultProject =
        accessibleProjects.length === 1
          ? (accessibleProjects[0] ?? null)
          : null;

      await recordMcpAuditEventSafely({
        ctx,
        methodName,
        outcome: "success",
      });

      return c.json(
        jsonRpcResult(
          request.id ?? null,
          buildInitializeResult({
            accessibleProjects,
            defaultProject,
          }),
        ),
        200,
        {
          "mcp-session-id": transportSessionId,
          "mcp-protocol-version": getMcpProtocolVersion(),
        },
      );
    }

    if (request.method === "notifications/initialized") {
      await recordMcpAuditEventSafely({
        ctx,
        methodName,
        outcome: "success",
      });

      return c.body(null, 202, {
        "mcp-session-id": transportSessionId,
        "mcp-protocol-version": getMcpProtocolVersion(),
      });
    }

    if (request.method === "ping") {
      await recordMcpAuditEventSafely({
        ctx,
        methodName,
        outcome: "success",
      });

      return c.json(jsonRpcResult(request.id ?? null, {}), 200, {
        "mcp-session-id": transportSessionId,
        "mcp-protocol-version": getMcpProtocolVersion(),
      });
    }

    if (request.method === "tools/list") {
      await recordMcpAuditEventSafely({
        ctx,
        methodName,
        outcome: "success",
      });

      return c.json(
        jsonRpcResult(request.id ?? null, {
          tools: mcpToolRegistry.listTools(),
        }),
        200,
        {
          "mcp-session-id": transportSessionId,
          "mcp-protocol-version": getMcpProtocolVersion(),
        },
      );
    }

    if (request.method === "tools/call") {
      const name =
        typeof request.params === "object" &&
        request.params !== null &&
        "name" in request.params &&
        typeof (request.params as { name?: unknown }).name === "string"
          ? (request.params as { name: string }).name
          : null;

      if (!name || !mcpToolRegistry.has(name)) {
        throw new JsonRpcRequestError(
          -32601,
          "Method not found",
          request.id ?? null,
        );
      }

      let result;
      try {
        result = await mcpToolRegistry.execute(
          name,
          ctx,
          typeof request.params === "object" &&
            request.params !== null &&
            "arguments" in request.params
            ? (request.params as { arguments?: unknown }).arguments
            : undefined,
        );
      } catch (err) {
        if (err instanceof McpToolExecutionError) {
          await recordMcpAuditEventSafely({
            ctx,
            methodName: name,
            outcome: "error",
            detail: err.message,
          });

          return c.json(
            jsonRpcResult(request.id ?? null, {
              content: [{ type: "text", text: err.message }],
              isError: true,
            }),
            200,
            {
              "mcp-session-id": transportSessionId,
              "mcp-protocol-version": getMcpProtocolVersion(),
            },
          );
        }
        throw err;
      }

      await recordMcpAuditEventSafely({
        ctx,
        methodName: name,
        outcome: "success",
      });

      return c.json(
        jsonRpcResult(request.id ?? null, {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
          isError: false,
        }),
        200,
        {
          "mcp-session-id": transportSessionId,
          "mcp-protocol-version": getMcpProtocolVersion(),
        },
      );
    }

    throw new JsonRpcRequestError(
      -32601,
      "Method not found",
      request.id ?? null,
    );
  } catch (err) {
    if (err instanceof McpAuthError) {
      return oauthErrorResponse(c, err);
    }

    if (err instanceof JsonRpcRequestError) {
      if (ctx) {
        await recordMcpAuditEventSafely({
          ctx,
          methodName,
          outcome: "error",
          detail: err.message,
        });
      }
      return c.json(jsonRpcError(err.id, err.code, err.message), 400);
    }

    if (ctx) {
      await recordMcpAuditEventSafely({
        ctx,
        methodName,
        outcome: "error",
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    throw err;
  }
});
