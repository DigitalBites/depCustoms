import { createHash, randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  events,
  project_tokens,
  tenant_entitlements,
  violations,
  violation_suppressions,
  policy_evaluations,
  project_findings,
  package_versions,
  packages,
} from "../db/schema.js";
import { subscriptionManager } from "../sse/subscription-manager.js";
import type { EventPayload } from "../types/event.js";
import type {
  PackageIntelligenceConnector,
  ConnectorResult,
  VulnSeverity,
} from "../connectors/types.js";
import {
  buildCachedSnapshot,
  upsertCachedResultWithFindings,
} from "../connectors/cache.js";
import { CONTRIBUTOR_FACTS_UNAVAILABLE_ERROR } from "../connectors/contributor/index.js";
import { ContributorConnector } from "../connectors/contributor/index.js";
import {
  loadEffectivePolicy,
  upsertConnectorSnapshot,
  loadSnapshots,
} from "../policy/effective.js";
import { resolveFields, unavailableSnapshot } from "../policy/resolver.js";
import { evaluateCondition, renderTemplate } from "../policy/expression.js";
import { log, serializeError } from "../logger.js";
import { ServeMode } from "../gen/customs/v1/gateway_pb.js";
import { DECISION_ALLOW, DECISION_BLOCK, serveModeToString } from "./shared.js";
import type { VerifiedProxyContext } from "./proxy-context.js";

export async function handleCheck(
  proxy: VerifiedProxyContext,
  req: {
    project_token: string;
    ecosystem: string;
    package: string;
    version: string;
    trace_id: string;
    request_id: string;
    span_id: string;
    client_ip: string | null;
    proxy_ip: string | null;
    contributor_context?: {
      requested_version: string;
      requested_version_published_at: string | null;
      slice_extracted_at: string;
      slice_window_days: number;
      slice_history_complete: boolean;
      slice_oldest_included_published_at: string | null;
      package_metadata_fingerprint: string | null;
      slice_fingerprint: string | null;
      versions: Array<{
        version: string;
        published_at: string;
        publisher: string | null;
        maintainers: string[];
        has_install_scripts: boolean;
        has_attestation: boolean;
        raw_payload_json: string | null;
      }>;
    } | null;
  },
  connectors: PackageIntelligenceConnector[] = [],
): Promise<{
  decision: number;
  reason: string;
  detail: string;
  cache_ttl_seconds: number;
  serve_mode: number;
  tenant_id: string;
  project_id: string;
}> {
  const invalidToken = {
    decision: DECISION_BLOCK,
    reason: "invalid_token",
    detail: "Token not found, expired, or has been revoked",
    cache_ttl_seconds: 0,
    serve_mode: ServeMode.UNSPECIFIED,
    tenant_id: "",
    project_id: "",
  };

  const proxyTenantId = proxy.tenantId;

  const tokenHash = createHash("sha256")
    .update(req.project_token)
    .digest("hex");
  const [tokenRow] = await db
    .select({
      id: project_tokens.id,
      project_id: project_tokens.project_id,
      tenant_id: project_tokens.tenant_id,
      revoked_at: project_tokens.revoked_at,
      expires_at: project_tokens.expires_at,
    })
    .from(project_tokens)
    .where(eq(project_tokens.token_hash, tokenHash))
    .limit(1);

  if (
    !tokenRow ||
    tokenRow.revoked_at !== null ||
    (tokenRow.expires_at !== null &&
      tokenRow.expires_at.getTime() <= Date.now())
  ) {
    return invalidToken;
  }
  if (tokenRow.tenant_id !== proxyTenantId) return invalidToken;

  db.update(project_tokens)
    .set({ last_used_at: new Date() })
    .where(eq(project_tokens.id, tokenRow.id))
    .catch((err) =>
      log.warn("project_token_last_used_update_failed", {
        project_token_id: tokenRow.id,
        tenant_id,
        project_id,
        trace_id: req.trace_id || null,
        ...serializeError(err),
      }),
    );

  const { project_id, tenant_id } = tokenRow;

  const entitlementRow = await db
    .select({
      allowed_ecosystems: tenant_entitlements.allowed_ecosystems,
      serve_mode: tenant_entitlements.serve_mode,
      cache_ttl_seconds: tenant_entitlements.cache_ttl_seconds,
    })
    .from(tenant_entitlements)
    .where(eq(tenant_entitlements.tenant_id, tenant_id))
    .limit(1)
    .then(([row]) => row ?? null);

  const defaultCacheTtl = entitlementRow?.cache_ttl_seconds ?? 300;
  const serveMode: ServeMode =
    entitlementRow?.serve_mode === "SERVE_MODE_PULL"
      ? ServeMode.PULL
      : ServeMode.REDIRECT;

  const entitledEcosystems = entitlementRow?.allowed_ecosystems ?? null;
  if (
    entitledEcosystems !== null &&
    !entitledEcosystems.includes(req.ecosystem)
  ) {
    return {
      decision: DECISION_BLOCK,
      reason: "ecosystem_not_permitted",
      detail: `${req.ecosystem} is not available on your current plan`,
      cache_ttl_seconds: defaultCacheTtl,
      serve_mode: ServeMode.UNSPECIFIED,
      tenant_id: tenant_id ?? "",
      project_id: project_id ?? "",
    };
  }

  if (!req.version) {
    recordEvent({
      proxy,
      tenant_id,
      project_id,
      tokenRow,
      req,
      decision: DECISION_ALLOW,
      reason: "metadata_request",
      detail: "Package metadata request — no version to evaluate",
      serveMode,
      cacheTtl: defaultCacheTtl,
      evaluationId: null,
    });
    return {
      decision: DECISION_ALLOW,
      reason: "metadata_request",
      detail: "Package metadata request — no version to evaluate",
      cache_ttl_seconds: defaultCacheTtl,
      serve_mode: serveMode,
      tenant_id: tenant_id ?? "",
      project_id: project_id ?? "",
    };
  }

  const evalStart = Date.now();
  const entityId = `${req.ecosystem}:${req.package}:${req.version}`;
  const policySnapshot = await loadEffectivePolicy(
    db,
    tenant_id,
    project_id ?? "",
  );

  if (policySnapshot.allRules.length === 0) {
    const evalMs = Date.now() - evalStart;
    const evaluationId = randomUUID();
    recordPolicyEvaluation({
      id: evaluationId,
      tenant_id,
      project_id,
      entityId,
      decision: "block",
      policiesEvaluated: 0,
      rulesEvaluated: 0,
      rulesMatched: 0,
      connectorSnapshotMeta: {},
      durationMs: evalMs,
      eventId: null,
    });
    recordEvent({
      proxy,
      tenant_id,
      project_id,
      tokenRow,
      req,
      decision: DECISION_BLOCK,
      reason: "no_policy",
      detail: "No active policy configured for this project or tenant",
      serveMode: ServeMode.UNSPECIFIED,
      cacheTtl: 0,
      evaluationId,
    });
    return {
      decision: DECISION_BLOCK,
      reason: "no_policy",
      detail: "No active policy configured for this project or tenant",
      cache_ttl_seconds: 0,
      serve_mode: ServeMode.UNSPECIFIED,
      tenant_id: tenant_id ?? "",
      project_id: project_id ?? "",
    };
  }

  const connectorMeta: Record<string, unknown> = {};
  const collectedFindings: Array<{
    connector_key: string;
    finding_id: string;
    severity: string;
    title: string | null;
  }> = [];

  if (req.contributor_context) {
    const contributorConnector = connectors.find(
      (connector): connector is ContributorConnector =>
        connector instanceof ContributorConnector,
    );
    if (contributorConnector) {
      const existingSlice = await db
        .select({
          contributor_slice_fingerprint:
            package_versions.contributor_slice_fingerprint,
        })
        .from(package_versions)
        .innerJoin(packages, eq(packages.id, package_versions.package_id))
        .where(
          and(
            eq(packages.ecosystem, req.ecosystem),
            eq(packages.package, req.package),
            eq(package_versions.version, req.version),
          ),
        )
        .limit(1);

      if (
        !req.contributor_context.slice_fingerprint ||
        existingSlice[0]?.contributor_slice_fingerprint !==
          req.contributor_context.slice_fingerprint
      ) {
        await contributorConnector.processPrefetchEvent(
          {
            ecosystem: req.ecosystem,
            package: req.package,
            extractedAt: req.contributor_context.slice_extracted_at,
            fingerprint: req.contributor_context.package_metadata_fingerprint,
            packageMetadataFingerprint:
              req.contributor_context.package_metadata_fingerprint,
            sliceFingerprint: req.contributor_context.slice_fingerprint,
            requestedVersion: req.contributor_context.requested_version,
            latestVersion: null,
            latestPublishedAt: null,
            historyComplete: req.contributor_context.slice_history_complete,
            oldestIncludedPublishedAt:
              req.contributor_context.slice_oldest_included_published_at,
            versions: req.contributor_context.versions.map((version) => ({
              version: version.version,
              publishedAt: version.published_at,
              publisher: version.publisher,
              maintainers: version.maintainers,
              hasInstallScripts: version.has_install_scripts,
              hasAttestation: version.has_attestation,
              rawPayloadJson: version.raw_payload_json,
            })),
          },
          db,
        );
      }
    }
  }

  for (const connector of connectors) {
    let fetchPromise: Promise<ConnectorResult> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let result: ConnectorResult | null = null;
    let failureStatus:
      | "timeout"
      | "error"
      | "background_pending"
      | "unavailable"
      | undefined;
    let errorCode: string | undefined;
    const fetchStartMs = Date.now();

    try {
      const cachedSnapshot = await buildCachedSnapshot(
        db,
        connector,
        req.ecosystem,
        req.package,
        req.version,
      );

      if (cachedSnapshot !== null) {
        const { snapshot, findings: cacheFindings } = cachedSnapshot;
        result = {
          summary: {
            vulnerability: {
              maxSeverity:
                ((snapshot.fields["max_severity"] as string) ?? "NONE") as VulnSeverity,
              findingCount: 0,
              fixAvailable: false,
              bestFixVersion: null,
            },
          },
          findings: [],
        };
        await upsertConnectorSnapshot(
          db,
          tenant_id,
          project_id ?? "",
          snapshot,
        );
        connectorMeta[connector.id] = snapshot.meta;

        for (const finding of cacheFindings) {
          collectedFindings.push({
            connector_key: connector.id,
            finding_id: finding.finding_id,
            severity: finding.severity,
            title: finding.title,
          });
        }
      } else {
        fetchPromise = connector.fetchSignals(
          req.ecosystem,
          req.package,
          req.version,
        );
        const responseDeadline = new Promise<never>((_, reject) => {
          deadlineTimer = setTimeout(
            () => reject(new Error("response_timeout")),
            connector.config.responseTimeoutMs,
          );
        });

        result = await Promise.race([fetchPromise, responseDeadline]);
        clearTimeout(deadlineTimer);
        deadlineTimer = undefined;

        const responseTimeMs = Date.now() - fetchStartMs;
        await upsertCachedResultWithFindings(
          db,
          connector,
          req.ecosystem,
          req.package,
          req.version,
          result,
        );

        const snapshot = connector.normalizeToSnapshot(result, {
          ecosystem: req.ecosystem,
          pkg: req.package,
          version: req.version,
          isCacheHit: false,
          responseTimeMs,
          cacheAgeHours: null,
        });
        await upsertConnectorSnapshot(
          db,
          tenant_id,
          project_id ?? "",
          snapshot,
        );
        connectorMeta[connector.id] = snapshot.meta;

        if (result.findings && result.findings.length > 0) {
          for (const finding of result.findings) {
            collectedFindings.push({
              connector_key: connector.id,
              finding_id: finding.findingId,
              severity: finding.severity,
              title: finding.title,
            });
          }
        }
      }
    } catch (err) {
      const isTimeout =
        err instanceof Error && err.message === "response_timeout";
      if (!isTimeout) {
        clearTimeout(deadlineTimer);
        deadlineTimer = undefined;
      }

      if (isTimeout && fetchPromise !== null) {
        failureStatus = "background_pending";
        errorCode = "response_timeout";
        fetchPromise
          .then((bgResult) =>
            upsertCachedResultWithFindings(
              db,
              connector,
              req.ecosystem,
              req.package,
              req.version,
              bgResult,
            ),
          )
          .catch((bgErr) =>
            log.warn("background_fetch_failed", {
              component: "policy_connectors",
              connector: connector.id,
              error: bgErr instanceof Error ? bgErr.message : String(bgErr),
            }),
          );
      } else if (
        err instanceof Error &&
        err.message === CONTRIBUTOR_FACTS_UNAVAILABLE_ERROR
      ) {
        failureStatus = "unavailable";
        errorCode = err.message;
      } else {
        failureStatus = "error";
        errorCode = err instanceof Error ? err.message : "unknown";
      }

      const responseTimeMs = Date.now() - fetchStartMs;
      const snapshot = connector.normalizeToSnapshot(
        null,
        {
          ecosystem: req.ecosystem,
          pkg: req.package,
          version: req.version,
          isCacheHit: false,
          responseTimeMs,
          cacheAgeHours: null,
        },
        failureStatus,
        errorCode,
      );

      await upsertConnectorSnapshot(db, tenant_id, project_id ?? "", snapshot);
      connectorMeta[connector.id] = snapshot.meta;
    }
  }

  const snapshots =
    connectors.length > 0
      ? await loadSnapshots(db, project_id ?? "", entityId, "artifact")
      : [];
  for (const connector of connectors) {
    if (!snapshots.some((snapshot) => snapshot.connectorKey === connector.id)) {
      snapshots.push(unavailableSnapshot(connector.id));
    }
  }

  const fields = resolveFields(snapshots, {
    ecosystem: req.ecosystem,
    pkg: req.package,
    version: req.version,
  });

  let decision = DECISION_ALLOW;
  let reason = "no_match";
  let detail = "No policy rules matched";
  let cacheTtl = defaultCacheTtl;
  let finalServeMode: ServeMode = serveMode;
  // Collect all blocking rule codes — joined with ',' so the reason field
  // enumerates every signal that triggered, not just the first one.
  const blockingReasonCodes: string[] = [];
  const collectedViolations: Array<{
    rule_id: string | null;
    policy_id: string | null;
    rule_name: string;
    policy_name: string;
    recommended_remediation: string | null;
    severity: string;
    code: string;
    message: string;
    enforcement_mode: string;
    blocked: boolean;
  }> = [];
  let rulesEvaluated = 0;
  let rulesMatched = 0;

  for (const rule of policySnapshot.allRules) {
    rulesEvaluated++;
    const matched = evaluateCondition(rule.condition, fields);
    if (!matched) continue;
    rulesMatched++;

    const action = rule.action;
    const actionType = action.type ?? "violation";
    const enfMode = rule.effectiveEnforcementMode;
    const message = action.message_template
      ? renderTemplate(action.message_template, fields)
      : `Rule "${rule.name}" matched`;

    if (
      actionType === "violation" ||
      actionType === "warning" ||
      actionType === "info"
    ) {
      collectedViolations.push({
        rule_id: rule.id,
        policy_id: rule.policyId,
        rule_name: rule.name,
        policy_name: rule.policyName,
        recommended_remediation: action.recommended_remediation ?? null,
        severity: action.severity ?? "high",
        code: action.code ?? "RULE_MATCHED",
        message,
        enforcement_mode: enfMode,
        blocked: actionType === "violation" && enfMode === "enforcing",
      });
    }

    if (actionType === "violation" && enfMode === "enforcing") {
      if (decision === DECISION_ALLOW) {
        // First blocking rule supplies the human-readable detail message.
        detail = message;
        cacheTtl = 0;
        finalServeMode = ServeMode.UNSPECIFIED;
      }
      decision = DECISION_BLOCK;
      blockingReasonCodes.push(action.code ?? "policy_violation");
    }
  }

  if (decision === DECISION_BLOCK) {
    // Enumerate every triggered signal — proxy logs and WAL events see all reasons.
    reason = blockingReasonCodes.join(",");
  } else if (rulesMatched === 0) {
    reason = "allowed";
    detail = "No policy rules matched — package allowed";
  } else {
    reason = "advisory_only";
    detail = "Rules matched in advisory mode only — package allowed";
  }

  const evaluationId = randomUUID();
  const evalMs = Date.now() - evalStart;
  recordPolicyEvaluationWithViolations({
    evaluationId,
    tenant_id,
    project_id: project_id ?? "",
    entityId,
    decision: decision === DECISION_ALLOW ? "allow" : "block",
    policiesEvaluated: policySnapshot.policies.length,
    rulesEvaluated,
    rulesMatched,
    connectorSnapshotMeta: connectorMeta,
    durationMs: evalMs,
    eventId: null,
    fieldValuesAtEvaluation: fields,
    collectedViolations: collectedViolations.map((violation) => ({
      ...violation,
      tenant_id,
      project_id: project_id ?? "",
      project_token_id: tokenRow.id,
      entity_id: entityId,
      entity_type: "artifact",
      evaluation_id: evaluationId,
      event_id: null,
      evaluated_at: new Date(),
    })),
    connectorFindings: collectedFindings,
  });

  const eventId = randomUUID();
  db.insert(events)
    .values({
      id: eventId,
      tenant_id,
      project_id,
      proxy_id: proxy.proxyId,
      ecosystem: req.ecosystem,
      package: req.package,
      version: req.version,
      decision: decision === DECISION_ALLOW ? "allow" : "block",
      reason,
      source: "policy_engine",
      event_type: "proxy_request",
      decision_cache: null,
      trace_id: req.trace_id || null,
      span_id: req.span_id || null,
      request_id: req.request_id || null,
      serve_mode:
        decision === DECISION_ALLOW ? serveModeToString(finalServeMode) : null,
      bytes_transferred: null,
      project_token_id: tokenRow.id,
      client_ip: req.client_ip,
      proxy_ip: req.proxy_ip,
      requested_at: new Date(),
    })
    .returning({ created_at: events.created_at })
    .then(([inserted]) => {
      const payload: EventPayload = {
        id: eventId,
        tenant_id,
        project_id,
        source: "policy_engine",
        event_type: "proxy_request",
        decision_cache: null,
        proxy_id: proxy.proxyId,
        ecosystem: req.ecosystem,
        package: req.package,
        version: req.version,
        decision: decision === DECISION_ALLOW ? "allow" : "block",
        reason,
        serve_mode:
          decision === DECISION_ALLOW
            ? serveModeToString(finalServeMode)
            : null,
        bytes_transferred: null,
        trace_id: req.trace_id || null,
        span_id: req.span_id || null,
        request_id: req.request_id || null,
        project_token_id: tokenRow.id,
        client_ip: req.client_ip,
        proxy_ip: req.proxy_ip,
        requested_at: new Date().toISOString(),
        created_at: inserted.created_at.toISOString(),
        cve_severity: null,
        fix_version: null,
      };
      subscriptionManager.publish(tenant_id, payload);
    })
    .catch((err) =>
      log.error("check_event_insert_failed", {
        trace_id: req.trace_id || null,
        ...serializeError(err),
      }),
    );

  return {
    decision,
    reason,
    detail,
    cache_ttl_seconds: cacheTtl,
    serve_mode: finalServeMode,
    tenant_id: tenant_id ?? "",
    project_id: project_id ?? "",
  };
}

function recordEvent(opts: {
  proxy: VerifiedProxyContext;
  tenant_id: string;
  project_id: string | null;
  tokenRow: { id: string };
  req: {
    ecosystem: string;
    package: string;
    version: string;
    trace_id: string;
    span_id: string;
    request_id: string;
    client_ip: string | null;
    proxy_ip: string | null;
  };
  decision: number;
  reason: string;
  detail: string;
  serveMode: ServeMode;
  cacheTtl: number;
  evaluationId: string | null;
}): void {
  const eventId = randomUUID();
  db.insert(events)
    .values({
      id: eventId,
      tenant_id: opts.tenant_id,
      project_id: opts.project_id,
      proxy_id: opts.proxy.proxyId,
      ecosystem: opts.req.ecosystem,
      package: opts.req.package,
      version: opts.req.version,
      decision: opts.decision === DECISION_ALLOW ? "allow" : "block",
      reason: opts.reason,
      source: "policy_engine",
      event_type: "proxy_request",
      decision_cache: null,
      trace_id: opts.req.trace_id || null,
      span_id: opts.req.span_id || null,
      request_id: opts.req.request_id || null,
      serve_mode:
        opts.decision === DECISION_ALLOW
          ? serveModeToString(opts.serveMode)
          : null,
      bytes_transferred: null,
      project_token_id: opts.tokenRow.id,
      client_ip: opts.req.client_ip,
      proxy_ip: opts.req.proxy_ip,
      requested_at: new Date(),
    })
    .catch((err) =>
      log.error("event_insert_failed", { ...serializeError(err) }),
    );
}

function recordPolicyEvaluation(opts: {
  id: string;
  tenant_id: string;
  project_id: string | null;
  entityId: string;
  decision: string;
  policiesEvaluated: number;
  rulesEvaluated: number;
  rulesMatched: number;
  connectorSnapshotMeta: Record<string, unknown>;
  durationMs: number;
  eventId: string | null;
}): void {
  db.insert(policy_evaluations)
    .values({
      id: opts.id,
      tenant_id: opts.tenant_id,
      project_id: opts.project_id ?? "",
      entity_id: opts.entityId,
      entity_type: "artifact",
      decision: opts.decision,
      policies_evaluated: opts.policiesEvaluated,
      rules_evaluated: opts.rulesEvaluated,
      rules_matched: opts.rulesMatched,
      connector_snapshot_meta: opts.connectorSnapshotMeta,
      duration_ms: opts.durationMs,
      event_id: opts.eventId,
      evaluated_at: new Date(),
    })
    .catch((err) =>
      log.error("policy_evaluation_insert_failed", { ...serializeError(err) }),
    );
}

function recordPolicyEvaluationWithViolations(opts: {
  evaluationId: string;
  tenant_id: string;
  project_id: string;
  entityId: string;
  decision: string;
  policiesEvaluated: number;
  rulesEvaluated: number;
  rulesMatched: number;
  connectorSnapshotMeta: Record<string, unknown>;
  durationMs: number;
  eventId: string | null;
  fieldValuesAtEvaluation: Record<string, unknown>;
  collectedViolations: Array<{
    rule_id: string | null;
    policy_id: string | null;
    rule_name: string;
    policy_name: string;
    recommended_remediation: string | null;
    project_token_id: string | null;
    tenant_id: string;
    project_id: string;
    entity_id: string;
    entity_type: string;
    severity: string;
    code: string;
    message: string;
    enforcement_mode: string;
    blocked: boolean;
    evaluation_id: string;
    event_id: string | null;
    evaluated_at: Date;
  }>;
  connectorFindings?: Array<{
    connector_key: string;
    finding_id: string;
    severity: string;
    title: string | null;
  }>;
}): void {
  Promise.resolve()
    .then(async () => {
      await db.insert(policy_evaluations).values({
        id: opts.evaluationId,
        tenant_id: opts.tenant_id,
        project_id: opts.project_id,
        entity_id: opts.entityId,
        entity_type: "artifact",
        decision: opts.decision,
        policies_evaluated: opts.policiesEvaluated,
        rules_evaluated: opts.rulesEvaluated,
        rules_matched: opts.rulesMatched,
        connector_snapshot_meta: opts.connectorSnapshotMeta,
        duration_ms: opts.durationMs,
        event_id: opts.eventId,
        evaluated_at: new Date(),
      });

      if (opts.collectedViolations.length > 0) {
        const suppressed = await db
          .select({
            entity_id: violation_suppressions.entity_id,
            rule_id: violation_suppressions.rule_id,
            project_id: violation_suppressions.project_id,
          })
          .from(violation_suppressions)
          .where(
            and(
              eq(violation_suppressions.tenant_id, opts.tenant_id),
              eq(
                violation_suppressions.entity_id,
                opts.collectedViolations[0].entity_id,
              ),
            ),
          );

        const isSuppressed = (violation: {
          rule_id: string | null;
          project_id: string;
          entity_id: string;
        }): boolean =>
          suppressed.some((row) => {
            if (row.entity_id !== violation.entity_id) return false;
            if (
              row.project_id !== null &&
              row.project_id !== violation.project_id
            ) {
              return false;
            }
            if (row.rule_id !== null && row.rule_id !== violation.rule_id) {
              return false;
            }
            return true;
          });

        await db.insert(violations).values(
          opts.collectedViolations.map((violation) => ({
            id: randomUUID(),
            tenant_id: violation.tenant_id,
            project_id: violation.project_id,
            rule_id: violation.rule_id,
            policy_id: violation.policy_id,
            project_token_id: violation.project_token_id,
            rule_name: violation.rule_name,
            policy_name: violation.policy_name,
            recommended_remediation: violation.recommended_remediation,
            entity_id: violation.entity_id,
            entity_type: violation.entity_type,
            severity: violation.severity,
            code: violation.code,
            message: violation.message,
            enforcement_mode: violation.enforcement_mode,
            blocked: violation.blocked,
            status: isSuppressed(violation) ? "suppressed" : "open",
            status_note: null,
            field_values_at_evaluation: opts.fieldValuesAtEvaluation,
            event_id: violation.event_id,
            evaluation_id: violation.evaluation_id,
            evaluated_at: violation.evaluated_at,
          })),
        );
      }

      if (opts.connectorFindings && opts.connectorFindings.length > 0) {
        const now = new Date();
        await db
          .insert(project_findings)
          .values(
            opts.connectorFindings.map((finding) => ({
              tenant_id: opts.tenant_id,
              project_id: opts.project_id,
              connector_key: finding.connector_key,
              entity_id: opts.entityId,
              finding_id: finding.finding_id,
              severity: finding.severity,
              title: finding.title,
              status: "open",
              first_seen_at: now,
              last_seen_at: now,
            })),
          )
          .onConflictDoUpdate({
            target: [
              project_findings.project_id,
              project_findings.connector_key,
              project_findings.entity_id,
              project_findings.finding_id,
            ],
            set: {
              severity: project_findings.severity,
              title: project_findings.title,
              last_seen_at: now,
              status: sql`CASE WHEN ${project_findings.status} = 'resolved' THEN 'open' ELSE ${project_findings.status} END`,
            },
          });
      }
    })
    .catch((err) =>
      log.error("policy_evaluation_write_failed", { ...serializeError(err) }),
    );
}
