import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  CAPABILITY,
  TENANT_PROXY_SCOPE,
  TENANT_PROXY_SCOPES,
} from "@customs/shared-constants";
import { getAuthContext, requireTenantCapability } from "../../http/guards.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";
import {
  disableProxy,
  enableProxy,
  revokeProxy,
  rotateProxySecret,
} from "./lifecycle-service.js";
import {
  createProxy,
  listTenantProxies,
  updateProxyTenantScope,
} from "./service.js";

export const proxyRoutes = new Hono();

const createProxySchema = z.object({
  name: z.string().min(1).max(100),
});
const updateProxyScopeSchema = z.object({
  tenant_scope: z.enum(TENANT_PROXY_SCOPES),
});

proxyRoutes.get("/v1/proxies", async (c) => {
  const { tenantId } = getAuthContext(c);

  const capabilityResult = requireTenantCapability(
    c,
    "proxies.read",
    "You do not have access to view proxies",
  );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

  const rows = await listTenantProxies(tenantId);
  return c.json({ proxies: rows });
});

proxyRoutes.post(
  "/v1/proxies",
  zValidator("json", createProxySchema),
  async (c) => {
    const { tenantId } = getAuthContext(c);

    const capabilityResult = requireTenantCapability(
      c,
      "proxies.write",
      "You do not have access to manage proxies",
    );
    if (!capabilityResult.ok) {
      return capabilityResult.response;
    }

    const { name } = c.req.valid("json");
    const proxy = await createProxy({ tenantId, name });

    return c.json(
      {
        ...proxy,
        message: "Store this secret now - it will not be shown again.",
      },
      201,
    );
  },
);

proxyRoutes.post("/v1/proxies/:proxyId/disable", async (c) => {
  const { tenantId, userId } = getAuthContext(c);
  const proxyIdResult = validateUuidParam(c, "proxyId", "Proxy ID");
  if (!proxyIdResult.ok) return proxyIdResult.response;
  const proxyId = proxyIdResult.value;

  const capabilityResult = requireTenantCapability(
    c,
    "proxies.write",
    "You do not have access to manage proxies",
  );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

  const row = await disableProxy({ tenantId, proxyId, actorUserId: userId });
  if (!row) {
    return errorJson(c, 404, "NOT_FOUND", "Proxy not found");
  }

  return c.json({ proxy_id: proxyId, status: row.status });
});

proxyRoutes.post("/v1/proxies/:proxyId/enable", async (c) => {
  const { tenantId, userId } = getAuthContext(c);
  const proxyIdResult = validateUuidParam(c, "proxyId", "Proxy ID");
  if (!proxyIdResult.ok) return proxyIdResult.response;
  const proxyId = proxyIdResult.value;

  const capabilityResult = requireTenantCapability(
    c,
    "proxies.write",
    "You do not have access to manage proxies",
  );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

  const row = await enableProxy({ tenantId, proxyId, actorUserId: userId });
  if (!row) {
    return errorJson(c, 404, "NOT_FOUND", "Proxy not found");
  }

  return c.json({ proxy_id: proxyId, status: row.status });
});

proxyRoutes.post(
  "/v1/proxies/:proxyId/scope",
  zValidator("json", updateProxyScopeSchema),
  async (c) => {
    const { tenantId } = getAuthContext(c);
    const proxyIdResult = validateUuidParam(c, "proxyId", "Proxy ID");
    if (!proxyIdResult.ok) return proxyIdResult.response;
    const proxyId = proxyIdResult.value;

    const capabilityResult = requireTenantCapability(
      c,
      "proxies.write",
      "You do not have access to manage proxies",
    );
    if (!capabilityResult.ok) {
      return capabilityResult.response;
    }

    const { tenant_scope } = c.req.valid("json");
    if (tenant_scope === TENANT_PROXY_SCOPE.ALL_TENANTS) {
      const platformCapabilityResult = requireTenantCapability(
        c,
        CAPABILITY.PLATFORM_PROXIES_SET_ALL_TENANTS,
        "You do not have access to share proxies across tenants",
      );
      if (!platformCapabilityResult.ok) {
        return platformCapabilityResult.response;
      }
    }

    const row = await updateProxyTenantScope({
      tenantId,
      proxyId,
      tenantScope: tenant_scope,
    });
    if (!row) {
      return errorJson(c, 404, "NOT_FOUND", "Proxy not found");
    }

    return c.json(row);
  },
);

proxyRoutes.post("/v1/proxies/:proxyId/rotate-secret", async (c) => {
  const { tenantId, userId } = getAuthContext(c);
  const proxyIdResult = validateUuidParam(c, "proxyId", "Proxy ID");
  if (!proxyIdResult.ok) return proxyIdResult.response;
  const proxyId = proxyIdResult.value;

  const capabilityResult = requireTenantCapability(
    c,
    "proxies.write",
    "You do not have access to manage proxies",
  );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

  const result = await rotateProxySecret({
    tenantId,
    proxyId,
    actorUserId: userId,
  });
  if (!result) {
    return errorJson(c, 404, "NOT_FOUND", "Proxy not found");
  }

  return c.json({
    proxy_id: proxyId,
    secret: result.secret,
    secret_prefix: result.secret_prefix,
    secret_rotated_at: result.secret_rotated_at,
    previous_secret_expires_at: result.previous_secret_expires_at.toISOString(),
    message: "Store this secret now - it will not be shown again.",
  });
});

proxyRoutes.delete("/v1/proxies/:proxyId", async (c) => {
  const { tenantId, userId } = getAuthContext(c);
  const proxyIdResult = validateUuidParam(c, "proxyId", "Proxy ID");
  if (!proxyIdResult.ok) return proxyIdResult.response;
  const proxyId = proxyIdResult.value;

  const capabilityResult = requireTenantCapability(
    c,
    "proxies.write",
    "You do not have access to manage proxies",
  );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

  const row = await revokeProxy({ tenantId, proxyId, actorUserId: userId });
  if (!row) {
    return errorJson(c, 404, "NOT_FOUND", "Proxy not found");
  }

  return c.json({ deleted: true, proxy_id: proxyId, status: row.status });
});
