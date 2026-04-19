import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { tenant_entitlements } from "../../db/schema.js";
import type { TenantInfo } from "../../auth/auth-claims.js";
import { canPerform, isTenantRole } from "../../middleware/rbac.js";

type GetMcpAvailabilityParams = {
  tenantId: string;
  tenants: TenantInfo[];
};

type GetMcpAvailabilityResult =
  | {
      ok: true;
      body: {
        tenant_id: string;
        mcp_enabled: boolean;
      };
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      detail?: string | null;
    };

export async function getMcpAvailability(
  params: GetMcpAvailabilityParams,
): Promise<GetMcpAvailabilityResult> {
  const membership = params.tenants.find(
    (tenant) => tenant.tenant_id === params.tenantId,
  );
  if (!membership) {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "You are not a member of that tenant",
      detail: null,
    };
  }

  if (
    !isTenantRole(membership.role) ||
    !canPerform(membership.role, "mcp.connect")
  ) {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: isTenantRole(membership.role)
        ? `Users with role "${membership.role}" cannot create MCP connections`
        : "User role cannot create MCP connections",
      detail: null,
    };
  }

  const [entitlement] = await db
    .select({ mcp_enabled: tenant_entitlements.mcp_enabled })
    .from(tenant_entitlements)
    .where(eq(tenant_entitlements.tenant_id, params.tenantId))
    .limit(1);

  return {
    ok: true,
    body: {
      tenant_id: params.tenantId,
      mcp_enabled: entitlement?.mcp_enabled ?? false,
    },
  };
}
