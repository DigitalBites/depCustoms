import type { TenantRole } from "../../middleware/rbac.js";

export type McpPrincipal = {
  userId: string;
  tenantId: string;
  role: TenantRole;
  tenants: {
    tenant_id: string;
    tenant_name: string;
    role: TenantRole;
  }[];
  audiences: string[];
  clientId: string | null;
  sessionId: string | null;
};

export type McpRequestContext = {
  principal: McpPrincipal;
  requestId: string;
  traceId: string | null;
  transportSessionId: string | null;
};
