import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { violation_suppressions } from "../../db/schema.js";
import { resolvePackageCatalogReferenceForEntityId } from "../packages/catalog-references.js";
import { getAuthContext, requireTenantCapability } from "../../http/guards.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";
import {
  createSuppressionSchema,
  loadSuppressionForTenant,
  projectExistsForTenant,
} from "./shared.js";

export const violationSuppressionWriteRouter = new Hono();

violationSuppressionWriteRouter.post(
  "/v1/violation-suppressions",
  zValidator("json", createSuppressionSchema),
  async (c) => {
    const capabilityResult = requireTenantCapability(c, "violations.write", "Access denied");
    if (!capabilityResult.ok) return capabilityResult.response;

    const { tenantId, userId } = getAuthContext(c);
    const body = c.req.valid("json");

    if (body.project_id) {
      const project = await projectExistsForTenant(body.project_id, tenantId);
      if (!project) {
        return errorJson(
          c,
          404,
          "NOT_FOUND",
          "Project not found",
          body.project_id,
        );
      }
    }

    const catalogReference = await resolvePackageCatalogReferenceForEntityId(
      db,
      body.entity_id,
    );

    const [suppression] = await db
      .insert(violation_suppressions)
      .values({
        tenant_id: tenantId,
        project_id: body.project_id ?? null,
        entity_id: body.entity_id,
        package_id: catalogReference.package_id,
        package_version_id: catalogReference.package_version_id,
        rule_id: body.rule_id ?? null,
        suppressed_by: userId ?? null,
        reason: body.reason ?? null,
        expires_at: body.expires_at ? new Date(body.expires_at) : null,
      })
      .returning();

    return c.json({ suppression }, 201);
  },
);

violationSuppressionWriteRouter.delete(
  "/v1/violation-suppressions/:id",
  async (c) => {
    const idResult = validateUuidParam(c, "id", "Suppression ID");
    if (!idResult.ok) return idResult.response;
    const id = idResult.value;
    const capabilityResult = requireTenantCapability(c, "violations.write", "Access denied");
    if (!capabilityResult.ok) return capabilityResult.response;

    const { tenantId } = getAuthContext(c);
    const existing = await loadSuppressionForTenant(id, tenantId);
    if (!existing) {
      return errorJson(c, 404, "NOT_FOUND", "Suppression not found", id);
    }

    await db
      .delete(violation_suppressions)
      .where(
        and(
          eq(violation_suppressions.id, id),
          eq(violation_suppressions.tenant_id, tenantId),
        ),
      );

    return c.json({ ok: true });
  },
);
