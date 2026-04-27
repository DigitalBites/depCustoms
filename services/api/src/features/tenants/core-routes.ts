import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { tenants, tenant_entitlements } from "../../db/schema.js";
import { errorJson } from "../../http/responses.js";
import {
  requireTenantCapability,
  requireTenantParamAccess,
} from "../../http/guards.js";
import { patchTenantSchema, putEntitlementsSchema } from "./shared.js";

export const tenantCoreRouter = new Hono();

tenantCoreRouter.get("/v1/tenants/:tenant_id", async (c) => {
  const tenantIdResult = requireTenantParamAccess(c);
  if (!tenantIdResult.ok) return tenantIdResult.response;
  const tenantId = tenantIdResult.value;

  const capabilityResult = requireTenantCapability(c, "overview.read", "Access denied");
    if (!capabilityResult.ok) return capabilityResult.response;

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant) {
    return errorJson(c, 404, "NOT_FOUND", "Tenant not found");
  }

  return c.json({ tenant });
});

tenantCoreRouter.patch(
  "/v1/tenants/:tenant_id",
  zValidator("json", patchTenantSchema),
  async (c) => {
    const tenantIdResult = requireTenantParamAccess(c);
    if (!tenantIdResult.ok) return tenantIdResult.response;
    const tenantId = tenantIdResult.value;

    const capabilityResult = requireTenantCapability(c, "settings.write", "Access denied");
    if (!capabilityResult.ok) return capabilityResult.response;

    const { name } = c.req.valid("json");

    const [tenant] = await db
      .update(tenants)
      .set({
        name,
        updated_at: new Date(),
      })
      .where(eq(tenants.id, tenantId))
      .returning();

    if (!tenant) {
      return errorJson(c, 404, "NOT_FOUND", "Tenant not found");
    }

    return c.json({ tenant });
  },
);

tenantCoreRouter.get("/v1/tenants/:tenant_id/entitlements", async (c) => {
  const tenantIdResult = requireTenantParamAccess(c);
  if (!tenantIdResult.ok) return tenantIdResult.response;
  const tenantId = tenantIdResult.value;

  const capabilityResult = requireTenantCapability(c, "settings.read", "Access denied");
    if (!capabilityResult.ok) return capabilityResult.response;

  const [row] = await db
    .select({
      allowed_ecosystems: tenant_entitlements.allowed_ecosystems,
      serve_mode: tenant_entitlements.serve_mode,
      cache_ttl_seconds: tenant_entitlements.cache_ttl_seconds,
      mcp_enabled: tenant_entitlements.mcp_enabled,
    })
    .from(tenant_entitlements)
    .where(eq(tenant_entitlements.tenant_id, tenantId))
    .limit(1);

  const entitlements = row ?? {
    allowed_ecosystems: null,
    serve_mode: "SERVE_MODE_REDIRECT",
    cache_ttl_seconds: 300,
    mcp_enabled: false,
  };

  return c.json({ entitlements });
});

tenantCoreRouter.put(
  "/v1/tenants/:tenant_id/entitlements",
  zValidator("json", putEntitlementsSchema),
  async (c) => {
    const tenantIdResult = requireTenantParamAccess(c);
    if (!tenantIdResult.ok) return tenantIdResult.response;
    const tenantId = tenantIdResult.value;

    const capabilityResult = requireTenantCapability(c, "settings.write", "Access denied");
    if (!capabilityResult.ok) return capabilityResult.response;

    const body = c.req.valid("json");

    const [existing] = await db
      .select({ id: tenant_entitlements.id })
      .from(tenant_entitlements)
      .where(eq(tenant_entitlements.tenant_id, tenantId))
      .limit(1);

    let row;
    if (existing) {
      [row] = await db
        .update(tenant_entitlements)
        .set({
          allowed_ecosystems: body.allowed_ecosystems,
          ...(body.serve_mode !== undefined
            ? { serve_mode: body.serve_mode }
            : {}),
          ...(body.cache_ttl_seconds !== undefined
            ? { cache_ttl_seconds: body.cache_ttl_seconds }
            : {}),
          ...(body.mcp_enabled !== undefined
            ? { mcp_enabled: body.mcp_enabled }
            : {}),
          updated_at: new Date(),
        })
        .where(eq(tenant_entitlements.id, existing.id))
        .returning();
    } else {
      [row] = await db
        .insert(tenant_entitlements)
        .values({
          tenant_id: tenantId,
          allowed_ecosystems: body.allowed_ecosystems,
          serve_mode: body.serve_mode ?? "SERVE_MODE_REDIRECT",
          cache_ttl_seconds: body.cache_ttl_seconds ?? 300,
          mcp_enabled: body.mcp_enabled ?? false,
        })
        .returning();
    }

    return c.json({ entitlements: row });
  },
);
