export type McpClientId = "codex" | "claude_code";

export interface McpSupportedClient {
  id: McpClientId;
  label: string;
}

export interface McpConnectionBootstrap {
  endpoint_url: string;
  tenant_id: string;
  client_name: string;
  protocol_version: string;
  auth: {
    authorization_url: string;
    token_url: string;
  };
  supported_clients: McpSupportedClient[];
}

export interface McpOAuthAuthorizationDetails {
  authorization_id: string;
  redirect_uri?: string;
  scope?: string;
  client: {
    id: string;
    name?: string;
    uri?: string;
    logo_uri?: string;
  };
  user: {
    id?: string;
    email?: string;
  };
}

export interface McpOAuthConsentResult {
  redirect_url: string;
}
