import { apiFetch } from "@/lib/api";
import { getValidPathSegmentParam } from "@/lib/route-params";
import type {
  McpClientId,
  McpConnectionBootstrap,
  McpOAuthAuthorizationDetails,
  McpOAuthConsentResult,
} from "@/features/mcp/types";

export async function bootstrapMcpConnection({
  tenantId,
  clientName,
}: {
  tenantId: string;
  clientName: McpClientId;
}): Promise<McpConnectionBootstrap> {
  return (await apiFetch("/v1/mcp/connections", {
    method: "POST",
    body: JSON.stringify({
      tenant_id: tenantId,
      client_name: clientName,
    }),
  })) as McpConnectionBootstrap;
}

export async function fetchMcpAvailability(tenantId: string): Promise<{
  tenant_id: string;
  mcp_enabled: boolean;
}> {
  return (await apiFetch(
    `/v1/mcp/availability?tenant_id=${encodeURIComponent(tenantId)}`,
  )) as {
    tenant_id: string;
    mcp_enabled: boolean;
  };
}

export async function fetchMcpOAuthAuthorization(
  authorizationId: string,
): Promise<McpOAuthAuthorizationDetails> {
  const validAuthorizationId = getValidPathSegmentParam(authorizationId);
  if (!validAuthorizationId) {
    throw new Error("Invalid authorization request identifier");
  }

  return (await apiFetch(
    `/oauth/authorizations/${encodeURIComponent(validAuthorizationId)}`,
  )) as McpOAuthAuthorizationDetails;
}

export async function submitMcpOAuthConsent({
  authorizationId,
  action,
}: {
  authorizationId: string;
  action: "approve" | "deny";
}): Promise<McpOAuthConsentResult> {
  const validAuthorizationId = getValidPathSegmentParam(authorizationId);
  if (!validAuthorizationId) {
    throw new Error("Invalid authorization request identifier");
  }

  return (await apiFetch(
    `/oauth/authorizations/${encodeURIComponent(validAuthorizationId)}/consent`,
    {
      method: "POST",
      body: JSON.stringify({ action }),
    },
  )) as McpOAuthConsentResult;
}
