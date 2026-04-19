import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import type { projects } from "../db/schema.js";
import { project_members } from "../db/schema.js";
import { errorJson, validateUuidParam } from "./responses.js";
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
): string | null {
  const tenantId = validateUuidParam(c, paramName, label);
  if (!tenantId) return null;

  if (tenantId !== c.get("tenantId")) {
    c.res = errorJson(
      c,
      403,
      "FORBIDDEN",
      "Access denied to this tenant",
    ) as any;
    return null;
  }

  return tenantId;
}

export function requireOwnerOrAdmin(c: Context): boolean {
  if (isOwnerOrAdmin(c.get("role"))) {
    return true;
  }

  c.res = errorJson(c, 403, "FORBIDDEN", "Owner or admin role required") as any;
  return false;
}

export function requireTenantOwnerOrAdminAccess(
  c: Context,
  paramName = "tenant_id",
  label = "Tenant ID",
): string | null {
  const tenantId = requireTenantParamAccess(c, paramName, label);
  if (!tenantId) return null;

  if (!requireOwnerOrAdmin(c)) {
    return null;
  }

  return tenantId;
}

export function requireTenantCapabilityAccess(
  c: Context,
  capability: TenantCapability,
  message = "Access denied",
  paramName = "tenant_id",
  label = "Tenant ID",
): string | null {
  const tenantId = requireTenantParamAccess(c, paramName, label);
  if (!tenantId) return null;

  if (!requireTenantCapability(c, capability, message)) {
    return null;
  }

  return tenantId;
}

export function requireTenantCapability(
  c: Context,
  capability: TenantCapability,
  message = "Access denied",
): boolean {
  const role = c.get("role");
  if (isTenantRole(role) && canPerform(role, capability)) {
    return true;
  }

  c.res = errorJson(c, 403, "FORBIDDEN", message) as any;
  return false;
}

export async function requireProjectAccess(
  c: Context,
  options: ProjectAccessOptions = {},
): Promise<{
  projectId: string;
  project: typeof projects.$inferSelect;
} | null> {
  const {
    hideForbiddenAsNotFound = false,
    paramName = "project_id",
    label = "Project ID",
  } = options;

  const projectId = validateUuidParam(c, paramName, label);
  if (!projectId) return null;

  const auth = getAuthContext(c);
  const project = await resolveProjectWithAccess(
    c,
    projectId,
    auth.tenantId,
    auth.userId,
    auth.role,
    { hideForbiddenAsNotFound },
  );
  if (!project) return null;

  return { projectId, project };
}

export async function requireResolvedProjectAccess(
  c: Context,
  projectId: string,
  options: Omit<ProjectAccessOptions, "paramName" | "label"> = {},
): Promise<{
  projectId: string;
  project: typeof projects.$inferSelect;
} | null> {
  const { hideForbiddenAsNotFound = false } = options;
  const auth = getAuthContext(c);
  const project = await resolveProjectWithAccess(
    c,
    projectId,
    auth.tenantId,
    auth.userId,
    auth.role,
    { hideForbiddenAsNotFound },
  );
  if (!project) return null;

  return { projectId, project };
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
