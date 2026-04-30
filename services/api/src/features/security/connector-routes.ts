import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { errorJson } from "../../http/responses.js";
import {
  requireProjectAccess,
  requireTenantCapability,
} from "../../http/guards.js";
import { connectorKeyParamSchema } from "../../http/validation.js";
import { getConnectors } from "../../connectors/runtime.js";
import {
  loadConnectorSyncCooldown,
  runProjectConnectorSync,
} from "./connector-sync-service.js";
import { selectProjectPackagesForSync } from "./connector-sync-selection.js";
import { connectorSyncQuerySchema } from "./shared.js";

export const projectSecurityConnectorRouter = new Hono();

projectSecurityConnectorRouter.post(
  "/v1/projects/:project_id/connectors/:connector_key/sync",
  zValidator("query", connectorSyncQuerySchema),
  async (c) => {
    const accessResult = await requireProjectAccess(c);
    if (!accessResult.ok) return accessResult.response;
    const access = accessResult.value;

    const { projectId, project } = access;
    const connectorKeyParsed = connectorKeyParamSchema.safeParse(
      c.req.param("connector_key"),
    );
    if (!connectorKeyParsed.success) {
      return errorJson(c, 400, "BAD_REQUEST", "Connector key is invalid");
    }
    const connectorKey = connectorKeyParsed.data;
    const { scope } = c.req.valid("query");

    const capabilityResult = requireTenantCapability(c, "connectors.write", "Access denied");
    if (!capabilityResult.ok) return capabilityResult.response;

    const connector = getConnectors().find(
      (candidate) => candidate.id === connectorKey,
    );
    if (!connector) {
      return errorJson(
        c,
        404,
        "NOT_FOUND",
        `Connector '${connectorKey}' not found or disabled`,
      );
    }

    const retryAfter = await loadConnectorSyncCooldown(projectId, connectorKey);
    if (retryAfter !== null) {
      c.header("Retry-After", String(retryAfter));
      return errorJson(
        c,
        429,
        "RATE_LIMITED",
        "Sync cooldown active",
        `retry_after=${retryAfter}s`,
      );
    }

    const packagesToSync = await selectProjectPackagesForSync(
      projectId,
      project.tenant_id,
      connectorKey,
      scope,
    );

    const result = await runProjectConnectorSync({
      tenantId: project.tenant_id,
      projectId,
      connectorKey,
      connector,
      packagesToSync,
    });

    return c.json(result);
  },
);
