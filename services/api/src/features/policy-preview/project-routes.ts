import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../../db/index.js";
import {
  getAuthContext,
  requireProjectAccess,
  requireTenantCapability,
} from "../../http/guards.js";
import { loadEffectivePolicy, loadSnapshots } from "../../policy/effective.js";
import {
  evaluateConditionWithTrace,
  renderTemplate,
} from "../../policy/expression.js";
import { resolveFields, unavailableSnapshot } from "../../policy/resolver.js";
import { extractConnectorKeys, projectPolicyPreviewSchema } from "./shared.js";
import type { RuleAction } from "../../policy/effective.js";
import { buildArtifactIdentity } from "../packages/artifact-identity.js";

export const policyPreviewProjectRouter = new Hono();

policyPreviewProjectRouter.post(
  "/v1/projects/:project_id/policy-preview",
  zValidator("json", projectPolicyPreviewSchema),
  async (c) => {
    const capabilityResult = requireTenantCapability(
        c,
        "policy_preview.read",
        "You do not have access to preview policies",
      );
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    const accessResult = await requireProjectAccess(c, {
      hideForbiddenAsNotFound: true,
    });
    if (!accessResult.ok) return accessResult.response;
    const access = accessResult.value;

    const { projectId } = access;
    const { tenantId } = getAuthContext(c);
    const body = c.req.valid("json");
    const snapshot = await loadEffectivePolicy(db, tenantId, projectId);
    if (snapshot.allRules.length === 0) {
      return c.json({
        decision: "allow",
        reason: "no_rules",
        detail: "No active rules configured",
        rules_evaluated: 0,
        rule_traces: [],
      });
    }
    const artifactIdentity = buildArtifactIdentity({
      ecosystem: body.ecosystem,
      package: body.package,
      version: body.version,
      source: "policy_preview",
    });

    const storedSnapshots = await loadSnapshots(
      db,
      projectId,
      artifactIdentity,
      "artifact",
    );

    const connectorKeys = new Set<string>();
    for (const rule of snapshot.allRules) {
      extractConnectorKeys(rule.condition, connectorKeys);
    }

    const allSnapshots = [...storedSnapshots];
    for (const key of connectorKeys) {
      if (!storedSnapshots.some((stored) => stored.connectorKey === key)) {
        allSnapshots.push(unavailableSnapshot(key));
      }
    }

    let fields = resolveFields(allSnapshots, {
      ecosystem: body.ecosystem,
      pkg: body.package,
      version: body.version,
    });

    if (body.field_overrides) {
      fields = { ...fields, ...body.field_overrides };
    }

    const ruleTraces: Array<{
      rule_id: string;
      rule_name: string;
      matched: boolean;
      action: RuleAction;
      enforcement_mode: string;
      trace: unknown;
      message?: string;
    }> = [];

    let decision: "allow" | "block" = "allow";
    let reason = "no_match";
    let detail = "";
    let blockedBy: string | null = null;

    for (const rule of snapshot.allRules) {
      const { result, trace } = evaluateConditionWithTrace(
        rule.condition,
        fields,
      );
      const action = rule.action;

      let message: string | undefined;
      if (result && action.message_template) {
        message = renderTemplate(action.message_template, fields);
      }

      ruleTraces.push({
        rule_id: rule.id,
        rule_name: rule.name,
        matched: result,
        action,
        enforcement_mode: rule.effectiveEnforcementMode,
        trace,
        message,
      });

      if (
        result &&
        action.type === "violation" &&
        rule.effectiveEnforcementMode === "enforcing" &&
        decision === "allow"
      ) {
        decision = "block";
        reason = action.code ?? "violation";
        detail =
          message ?? action.message_template ?? `Rule "${rule.name}" matched`;
        blockedBy = rule.id;
      }
    }

    return c.json({
      decision,
      reason,
      detail,
      blocked_by_rule_id: blockedBy,
      policies_evaluated: snapshot.policies.length,
      rules_evaluated: snapshot.allRules.length,
      rules_matched: ruleTraces.filter((trace) => trace.matched).length,
      field_map: fields,
      rule_traces: ruleTraces,
    });
  },
);
