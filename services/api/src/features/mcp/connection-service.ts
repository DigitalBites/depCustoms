import type { TenantInfo } from "../../auth/auth-claims.js";
import { config } from "../../config.js";
import { resolvePublicBaseUrl } from "../../http/public-base-url.js";
import { getMcpAvailability } from "./availability-service.js";

type BootstrapMcpConnectionParams = {
  requestUrl: string;
  requestHeaders: Headers;
  tenantId: string;
  clientName: string;
  tenants: TenantInfo[];
};

type BootstrapMcpConnectionResult =
  | {
      ok: true;
      body: Record<string, unknown>;
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      detail?: string | null;
    };

export async function bootstrapMcpConnection(
  params: BootstrapMcpConnectionParams,
): Promise<BootstrapMcpConnectionResult> {
  const availability = await getMcpAvailability({
    tenantId: params.tenantId,
    tenants: params.tenants,
  });
  if (!availability.ok) {
    return availability;
  }

  if (!availability.body.mcp_enabled) {
    return {
      ok: false,
      status: 403,
      code: "MCP_DISABLED",
      message: "MCP is not enabled for this tenant",
      detail: null,
    };
  }

  const baseUrl = resolvePublicBaseUrl(
    params.requestUrl,
    params.requestHeaders,
    config.authUrl,
  );

  return {
    ok: true,
    body: {
      endpoint_url: `${baseUrl}/api/mcp`,
      tenant_id: params.tenantId,
      client_name: params.clientName,
      protocol_version: "2025-11-25",
      auth: {
        authorization_url: `${baseUrl}/oauth/authorize`,
        token_url: `${baseUrl}/oauth/token`,
      },
      supported_clients: [
        { id: "codex", label: "Codex" },
        { id: "claude_code", label: "Claude Code" },
      ],
    },
  };
}
