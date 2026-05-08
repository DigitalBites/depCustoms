import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { connector_fields, policies } from "../../db/schema.js";
import { getAuthContext, requireTenantCapability } from "../../http/guards.js";
import { errorJson, validateUuidParam } from "../../http/responses.js";
import { buildCachedSnapshot } from "../../connectors/cache.js";
import { getConnectors } from "../../connectors/runtime.js";
import { unavailableSnapshot, resolveFields } from "../../policy/resolver.js";
import { evaluateConditionWithTrace } from "../../policy/expression.js";
import type { Condition } from "../../policy/expression.js";
import {
  extractConnectorKeys,
  rulePreviewSchema,
  validatePolicyConditionSchema,
} from "./shared.js";
import { BUILTIN_FIELD_REFS } from "../field-catalog/builtin-fields.js";

export const policyPreviewPolicyRouter = new Hono();

policyPreviewPolicyRouter.post(
  "/v1/policies/:policy_id/validate",
  zValidator("json", validatePolicyConditionSchema),
  async (c) => {
    const policyIdResult = validateUuidParam(c, "policy_id", "Policy ID");
    if (!policyIdResult.ok) return policyIdResult.response;
    const policyId = policyIdResult.value;

    const capabilityResult = requireTenantCapability(
      c,
      "policy_preview.read",
      "You do not have access to preview policies",
    );
    if (!capabilityResult.ok) {
      return capabilityResult.response;
    }

    const { tenantId } = getAuthContext(c);
    const [policy] = await db
      .select({ id: policies.id })
      .from(policies)
      .where(and(eq(policies.id, policyId), eq(policies.tenant_id, tenantId)))
      .limit(1);

    if (!policy) {
      return errorJson(c, 404, "NOT_FOUND", "Policy not found", policyId);
    }

    const body = c.req.valid("json");
    const knownFields = await db
      .select({
        canonical_ref: connector_fields.canonical_ref,
        deprecated: connector_fields.deprecated,
      })
      .from(connector_fields);

    const knownRefs = new Set(knownFields.map((field) => field.canonical_ref));
    const deprecatedRefs = new Set(
      knownFields
        .filter((field) => field.deprecated)
        .map((field) => field.canonical_ref),
    );
    const warnings: string[] = [];
    const errors: string[] = [];

    function validateConditionNode(cond: unknown): void {
      if (!cond || typeof cond !== "object") {
        errors.push("Invalid condition node");
        return;
      }

      const node = cond as Record<string, unknown>;
      if ("all" in node && Array.isArray(node.all)) {
        node.all.forEach(validateConditionNode);
        return;
      }
      if ("any" in node && Array.isArray(node.any)) {
        node.any.forEach(validateConditionNode);
        return;
      }
      if ("not" in node) {
        validateConditionNode(node.not);
        return;
      }
      if ("field" in node && typeof node.field === "string") {
        const field = node.field;
        if (
          !knownRefs.has(field) &&
          !BUILTIN_FIELD_REFS.has(field) &&
          !field.startsWith("source.")
        ) {
          warnings.push(
            `Field "${field}" is not in the connector field catalog - it may resolve to null`,
          );
        }
        if (deprecatedRefs.has(field)) {
          warnings.push(
            `Field "${field}" is deprecated and may be removed in a future version`,
          );
        }
        return;
      }

      errors.push(`Unrecognized condition node: ${JSON.stringify(cond)}`);
    }

    validateConditionNode(body.condition);

    return c.json({
      valid: errors.length === 0,
      errors,
      warnings,
    });
  },
);

policyPreviewPolicyRouter.post(
  "/v1/policies/:policy_id/rule-preview",
  zValidator("json", rulePreviewSchema),
  async (c) => {
    const policyIdResult = validateUuidParam(c, "policy_id", "Policy ID");
    if (!policyIdResult.ok) return policyIdResult.response;
    const policyId = policyIdResult.value;

    const capabilityResult = requireTenantCapability(
      c,
      "policy_preview.read",
      "You do not have access to preview policies",
    );
    if (!capabilityResult.ok) {
      return capabilityResult.response;
    }

    const { tenantId } = getAuthContext(c);
    const [policy] = await db
      .select({ id: policies.id })
      .from(policies)
      .where(and(eq(policies.id, policyId), eq(policies.tenant_id, tenantId)))
      .limit(1);

    if (!policy) {
      return errorJson(c, 404, "NOT_FOUND", "Policy not found", policyId);
    }

    const body = c.req.valid("json");
    const entityId = `${body.ecosystem}:${body.package}:${body.version}`;
    const condition = body.condition as Condition;

    const connectorKeys = new Set<string>();
    extractConnectorKeys(condition, connectorKeys);

    const connectors = getConnectors().filter((connector) =>
      connectorKeys.size === 0 ? true : connectorKeys.has(connector.id),
    );
    const snapshots = await Promise.all(
      connectors.map(async (connector) => {
        const cached = await buildCachedSnapshot(
          db,
          connector,
          body.ecosystem,
          body.package,
          body.version,
        );
        return cached?.snapshot ?? unavailableSnapshot(connector.id);
      }),
    );

    const fields = resolveFields(snapshots, {
      ecosystem: body.ecosystem,
      pkg: body.package,
      version: body.version,
    });
    const { result, trace } = evaluateConditionWithTrace(condition, fields);

    const connectorStatuses = Object.fromEntries(
      snapshots.map((snapshot) => [
        snapshot.connectorKey,
        {
          status: snapshot.meta.status,
          cache_age_hours: snapshot.meta.cacheAgeHours,
        },
      ]),
    );

    return c.json({
      matched: result,
      entity_id: entityId,
      connector_statuses: connectorStatuses,
      field_values: fields,
      trace,
    });
  },
);
