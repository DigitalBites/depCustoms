import { z } from "zod";
import {
  isAssignableTenantRole,
  isDirectCreatableTenantRole,
  isManageableTenantRole,
  type AssignableTenantRole,
  type DirectCreatableTenantRole,
  type ManageableTenantRole,
} from "../../middleware/rbac.js";

export const putEntitlementsSchema = z.object({
  allowed_ecosystems: z.array(z.string()).nullable(),
  serve_mode: z.enum(["SERVE_MODE_REDIRECT", "SERVE_MODE_PULL"]).optional(),
  cache_ttl_seconds: z.number().int().min(30).max(86400).optional(),
  mcp_enabled: z.boolean().optional(),
});

export const patchTenantSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.custom<AssignableTenantRole>(
    (value) => typeof value === "string" && isAssignableTenantRole(value),
    "Invalid assignable role",
  ),
  project_id: z.string().uuid().optional(),
});

export const createMemberSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.custom<DirectCreatableTenantRole>(
    (value) => typeof value === "string" && isDirectCreatableTenantRole(value),
    "Invalid direct-creatable role",
  ),
  project_id: z.string().uuid().optional(),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(8),
});

export const patchMemberRoleSchema = z.object({
  role: z.custom<ManageableTenantRole>(
    (value) => typeof value === "string" && isManageableTenantRole(value),
    "Invalid manageable role",
  ),
});
