import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import type { projects } from "../db/schema.js";
import { project_members } from "../db/schema.js";
import {
  errorResult,
  okResult,
  type HttpResult,
  validateUuidParam,
} from "./responses.js";
import type { AuthContext } from "../middleware/auth.js";
import {
  canPerform,
  hasImplicitProjectAccess,
  isTenantRole,
  isOwnerOrAdmin,
  resolveProjectWithAccess,
  type TenantCapability,
} from "../middleware/rbac.js";

type ProjectAccessOptions = {
  hideForbiddenAsNotFound?: boolean;
  paramName?: string;
  label?: string;
};

export function getAuthContext(c: Context): AuthContext {
  return {
    tenantId: c.get("tenantId"),
    userId: c.get("userId"),
    role: c.get("role"),
    tenants: c.get("tenants"),
  };
}

export function requireTenantParamAccess(
  c: Context,
  paramName = "tenant_id",
  label = "Tenant ID",
): HttpResult<string> {
  const tenantIdResult = validateUuidParam(c, paramName, label);
  if (!tenantIdResult.ok) return tenantIdResult;
  const tenantId = tenantIdResult.value;

  if (tenantId !== c.get("tenantId")) {
    return errorResult(
      c,
      403,
      "FORBIDDEN",
      "Access denied to this tenant",
    );
  }

  return okResult(tenantId);
}

export function requireOwnerOrAdmin(c: Context): HttpResult<void> {
  if (isOwnerOrAdmin(c.get("role"))) {
    return okResult(undefined);
  }

  return errorResult(c, 403, "FORBIDDEN", "Owner or admin role required");
}

export function requireTenantOwnerOrAdminAccess(
  c: Context,
  paramName = "tenant_id",
  label = "Tenant ID",
): HttpResult<string> {
  const tenantIdResult = requireTenantParamAccess(c, paramName, label);
  if (!tenantIdResult.ok) return tenantIdResult;

  const ownerOrAdminResult = requireOwnerOrAdmin(c);
  if (!ownerOrAdminResult.ok) return ownerOrAdminResult;

  return okResult(tenantIdResult.value);
}

export function requireTenantCapabilityAccess(
  c: Context,
  capability: TenantCapability,
  message = "Access denied",
  paramName = "tenant_id",
  label = "Tenant ID",
): HttpResult<string> {
  const tenantIdResult = requireTenantParamAccess(c, paramName, label);
  if (!tenantIdResult.ok) return tenantIdResult;

  const capabilityResult = requireTenantCapability(c, capability, message);
  if (!capabilityResult.ok) return capabilityResult;

  return okResult(tenantIdResult.value);
}

export function requireTenantCapability(
  c: Context,
  capability: TenantCapability,
  message = "Access denied",
): HttpResult<void> {
  const role = c.get("role");
  if (isTenantRole(role) && canPerform(role, capability)) {
    return okResult(undefined);
  }

  return errorResult(c, 403, "FORBIDDEN", message);
}

export async function requireProjectAccess(
  c: Context,
  options: ProjectAccessOptions = {},
): Promise<HttpResult<{
  projectId: string;
  project: typeof projects.$inferSelect;
}>> {
  const {
    hideForbiddenAsNotFound = false,
    paramName = "project_id",
    label = "Project ID",
  } = options;

  const projectIdResult = validateUuidParam(c, paramName, label);
  if (!projectIdResult.ok) return projectIdResult;
  const projectId = projectIdResult.value;

  const auth = getAuthContext(c);
  const projectResult = await resolveProjectWithAccess(
    c,
    projectId,
    auth.tenantId,
    auth.userId,
    auth.role,
    { hideForbiddenAsNotFound },
  );
  if (!projectResult.ok) return projectResult;

  return okResult({ projectId, project: projectResult.value });
}

export async function requireResolvedProjectAccess(
  c: Context,
  projectId: string,
  options: Omit<ProjectAccessOptions, "paramName" | "label"> = {},
): Promise<HttpResult<{
  projectId: string;
  project: typeof projects.$inferSelect;
}>> {
  const { hideForbiddenAsNotFound = false } = options;
  const auth = getAuthContext(c);
  const projectResult = await resolveProjectWithAccess(
    c,
    projectId,
    auth.tenantId,
    auth.userId,
    auth.role,
    { hideForbiddenAsNotFound },
  );
  if (!projectResult.ok) return projectResult;

  return okResult({ projectId, project: projectResult.value });
}

export async function listAccessibleProjectIds(
  c: Context,
): Promise<string[] | null> {
  const auth = getAuthContext(c);
  if (hasImplicitProjectAccess(auth.role)) {
    return null;
  }

  const rows = await db
    .select({ project_id: project_members.project_id })
    .from(project_members)
    .where(
      and(
        eq(project_members.user_id, auth.userId),
        eq(project_members.tenant_id, auth.tenantId),
      ),
    );

  return rows.map((row) => row.project_id);
}
