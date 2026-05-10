import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { hashProjectToken } from "../auth/hashing.js";
import { db } from "../db/index.js";
import {
  events,
  project_tokens,
  tenant_entitlements,
  violations,
  violation_occurrences,
  violation_suppressions,
  policy_evaluations,
  package_versions,
  packages,
} from "../db/schema.js";
import { subscriptionManager } from "../sse/subscription-manager.js";
import type { EventPayload } from "../types/event.js";
import type {
  ConnectorArtifactEvent,
  ConnectorEventOutcome,
  PackageIntelligenceConnector,
  ConnectorResult,
} from "../connectors/types.js";
import {
  buildCachedSnapshot,
  getPackageScopedCachedResult,
  upsertPackageScopedCachedResult,
  upsertCachedResultWithFindings,
} from "../connectors/cache.js";
import {
  buildArtifactRequestEvent,
  buildPackageMetadataEvent,
  connectorSupportsEvent,
  eventEntityContext,
} from "../connectors/events.js";
import { CONTRIBUTOR_FACTS_UNAVAILABLE_ERROR } from "../connectors/contributor/index.js";
import { ContributorConnector } from "../connectors/contributor/index.js";
import {
  loadEffectivePolicy,
  upsertConnectorSnapshot,
  loadSnapshots,
} from "../policy/effective.js";
import { resolveFields, unavailableSnapshot } from "../policy/resolver.js";
import { evaluateCondition, renderTemplate } from "../policy/expression.js";
import type { Condition } from "../policy/expression.js";
import { log, serializeError } from "../logger.js";
import { ServeMode } from "../gen/customs/v1/gateway_pb.js";
import { upsertProjectFindingsForEntity } from "../features/security/project-findings.js";
import { DECISION_ALLOW, DECISION_BLOCK, serveModeToString } from "./shared.js";
import type { VerifiedProxyContext } from "./proxy-context.js";
import { canonicalizePackageIdentity } from "../features/packages/identity.js";
import {
  resolveArtifactIdentity,
  type ArtifactIdentity,
} from "../features/packages/artifact-identity.js";

type CheckOutcome = {
  decision: number;
  reason: string;
  detail: string;
  cache_ttl_seconds: number;
  serve_mode: number;
  tenant_id: string;
  project_id: string;
};

type CheckRequest = {
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
};

type CollectedViolationForWrite = {
  rule_id: string | null;
  policy_id: string | null;
  rule_name: string;
  policy_name: string;
  recommended_remediation: string | null;
  project_token_id: string | null;
  tenant_id: string;
  project_id: string;
  entity_type: string;
  severity: string;
  code: string;
  message: string;
  enforcement_mode: string;
  blocked: boolean;
  evaluation_id: string;
  evaluated_at: Date;
};

type ProjectTokenRow = {
  id: string;
  project_id: string;
  tenant_id: string;
  revoked_at: Date | null;
  expires_at: Date | null;
};

type CheckContext = {
  tokenRow: ProjectTokenRow;
  tenantId: string;
  projectId: string;
  defaultCacheTtl: number;
  serveMode: ServeMode;
};

type PackageReleaseContext = {
  versionPublishedAt: string | null;
  versionAgeDays: number | null;
  latestVersionPublishedAt: string | null;
};

const latestPackageVersions = alias(
  package_versions,
  "check_latest_package_versions",
);

type EvaluatedPolicyDecision = {
  decision: number;
  reason: string;
  detail: string;
  cacheTtl: number;
  serveMode: ServeMode;
  rulesEvaluated: number;
  rulesMatched: number;
  collectedViolations: Array<{
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
  }>;
};

function isConnectorUnavailableError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  return (
    err.message === CONTRIBUTOR_FACTS_UNAVAILABLE_ERROR ||
    err.message === "intelligence_http_429" ||
    err.message === "intelligence_http_503"
  );
}

export async function handleCheck(
  proxy: VerifiedProxyContext,
  req: CheckRequest,
  connectors: PackageIntelligenceConnector[] = [],
): Promise<CheckOutcome> {
  const invalidToken = buildCheckOutcome({
    decision: DECISION_BLOCK,
    reason: "invalid_token",
    detail: "Token not found, expired, or has been revoked",
    cacheTtlSeconds: 0,
    serveMode: ServeMode.UNSPECIFIED,
  });

  const checkContext = await loadCheckContext(proxy, req);
  if (!checkContext) {
    return invalidToken;
  }
  const { tokenRow, tenantId, projectId, defaultCacheTtl, serveMode } =
    checkContext;
  const artifactIdentity = await resolveArtifactIdentity(db, {
    ecosystem: req.ecosystem,
    package: req.package,
    version: req.version,
    source: "check",
  });
  const normalizedReq: CheckRequest = {
    ...req,
    ecosystem: artifactIdentity.ecosystem,
    package: artifactIdentity.package,
    version: artifactIdentity.version ?? "",
  };

  const entitledEcosystems = checkContextEntitledEcosystems(checkContext);
  if (
    entitledEcosystems !== null &&
    !entitledEcosystems.includes(normalizedReq.ecosystem)
  ) {
    return buildCheckOutcome({
      decision: DECISION_BLOCK,
      reason: "ecosystem_not_permitted",
      detail: `${normalizedReq.ecosystem} is not available on your current plan`,
      cacheTtlSeconds: defaultCacheTtl,
      serveMode: ServeMode.UNSPECIFIED,
      tenantId,
      projectId,
    });
  }

  if (!normalizedReq.version) {
    warmPackageScopedConnectors(
      artifactIdentity,
      connectors,
      {
        tenantId,
        projectId,
      },
    );
    void recordCheckEvent({
      proxy,
      tenant_id: tenantId,
      project_id: projectId,
      tokenRow,
      req: normalizedReq,
      artifactIdentity,
      decision: DECISION_ALLOW,
      reason: "metadata_request",
      serveMode,
    });
    return buildCheckOutcome({
      decision: DECISION_ALLOW,
      reason: "metadata_request",
      detail: "Package metadata request — no version to evaluate",
      cacheTtlSeconds: defaultCacheTtl,
      serveMode,
      tenantId,
      projectId,
    });
  }

  const evalStart = Date.now();
  const policySnapshot = await loadEffectivePolicy(db, tenantId, projectId);

  if (policySnapshot.allRules.length === 0) {
    const evalMs = Date.now() - evalStart;
    const evaluationId = randomUUID();
    const eventId = randomUUID();
    void recordCheckEvent({
      eventId,
      proxy,
      tenant_id: tenantId,
      project_id: projectId,
      tokenRow,
      req: normalizedReq,
      artifactIdentity,
      decision: DECISION_BLOCK,
      reason: "no_policy",
      serveMode: ServeMode.UNSPECIFIED,
    }).then((insertedEventId) => {
      recordPolicyEvaluation({
        id: evaluationId,
        tenant_id: tenantId,
        project_id: projectId,
        artifactIdentity,
        decision: "block",
        policiesEvaluated: 0,
        rulesEvaluated: 0,
        rulesMatched: 0,
        connectorSnapshotMeta: {},
        fieldValuesAtEvaluation: {},
        durationMs: evalMs,
        eventId: insertedEventId,
      });
    });
    return buildCheckOutcome({
      decision: DECISION_BLOCK,
      reason: "no_policy",
      detail: "No active policy configured for this project or tenant",
      cacheTtlSeconds: 0,
      serveMode: ServeMode.UNSPECIFIED,
      tenantId,
      projectId,
    });
  }

  const { connectorMeta, fields } = await collectConnectorEvaluationFields({
    req: normalizedReq,
    connectors,
    tenantId,
    projectId,
    artifactIdentity,
  });
  const evaluatedDecision = evaluatePolicyDecision(
    policySnapshot.allRules,
    fields,
    defaultCacheTtl,
    serveMode,
  );

  const evaluationId = randomUUID();
  const eventId = randomUUID();
  const evalMs = Date.now() - evalStart;
  void recordCheckEvent({
    eventId,
    proxy,
    tenant_id: tenantId,
    project_id: projectId,
    tokenRow,
    req: normalizedReq,
    artifactIdentity,
    decision: evaluatedDecision.decision,
    reason: evaluatedDecision.reason,
    serveMode: evaluatedDecision.serveMode,
    publishToSse: true,
  }).then((insertedEventId) => {
    recordPolicyEvaluationWithViolations({
      evaluationId,
      tenant_id: tenantId,
      project_id: projectId,
      artifactIdentity,
      decision:
        evaluatedDecision.decision === DECISION_ALLOW ? "allow" : "block",
      policiesEvaluated: policySnapshot.policies.length,
      rulesEvaluated: evaluatedDecision.rulesEvaluated,
      rulesMatched: evaluatedDecision.rulesMatched,
      connectorSnapshotMeta: connectorMeta,
      durationMs: evalMs,
      eventId: insertedEventId,
      fieldValuesAtEvaluation: fields,
      collectedViolations: evaluatedDecision.collectedViolations.map(
        (violation) => ({
          ...violation,
          tenant_id: tenantId,
          project_id: projectId,
          project_token_id: tokenRow.id,
          entity_type: "artifact",
          evaluation_id: evaluationId,
          evaluated_at: new Date(),
        }),
      ),
    });
  });

  return buildCheckOutcome({
    decision: evaluatedDecision.decision,
    reason: evaluatedDecision.reason,
    detail: evaluatedDecision.detail,
    cacheTtlSeconds: evaluatedDecision.cacheTtl,
    serveMode: evaluatedDecision.serveMode,
    tenantId,
    projectId,
  });
}

function buildCheckOutcome(input: {
  decision: number;
  reason: string;
  detail: string;
  cacheTtlSeconds: number;
  serveMode: number;
  tenantId?: string | null;
  projectId?: string | null;
}): CheckOutcome {
  return {
    decision: input.decision,
    reason: input.reason,
    detail: input.detail,
    cache_ttl_seconds: input.cacheTtlSeconds,
    serve_mode: input.serveMode,
    tenant_id: input.tenantId ?? "",
    project_id: input.projectId ?? "",
  };
}

async function loadCheckContext(
  proxy: VerifiedProxyContext,
  req: CheckRequest,
): Promise<(CheckContext & { entitledEcosystems: string[] | null }) | null> {
  const tokenRow = await loadAuthorizedProjectToken(
    proxy.tenantId,
    req.project_token,
  );
  if (!tokenRow) {
    return null;
  }

  const tenantId = tokenRow.tenant_id;
  const projectId = tokenRow.project_id ?? "";
  scheduleProjectTokenLastUsedUpdate(tokenRow, req, tenantId, projectId);

  const entitlementRow = await db
    .select({
      allowed_ecosystems: tenant_entitlements.allowed_ecosystems,
      serve_mode: tenant_entitlements.serve_mode,
      cache_ttl_seconds: tenant_entitlements.cache_ttl_seconds,
    })
    .from(tenant_entitlements)
    .where(eq(tenant_entitlements.tenant_id, tenantId))
    .limit(1)
    .then(([row]) => row ?? null);

  return {
    tokenRow,
    tenantId,
    projectId,
    defaultCacheTtl: entitlementRow?.cache_ttl_seconds ?? 300,
    serveMode:
      entitlementRow?.serve_mode === "SERVE_MODE_PULL"
        ? ServeMode.PULL
        : ServeMode.REDIRECT,
    entitledEcosystems: entitlementRow?.allowed_ecosystems ?? null,
  };
}

async function loadAuthorizedProjectToken(
  proxyTenantId: string,
  projectToken: string,
): Promise<ProjectTokenRow | null> {
  const tokenHash = hashProjectToken(projectToken);
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
    tokenRow.tenant_id !== proxyTenantId ||
    tokenRow.revoked_at !== null ||
    (tokenRow.expires_at !== null &&
      tokenRow.expires_at.getTime() <= Date.now())
  ) {
    return null;
  }

  return tokenRow;
}

function scheduleProjectTokenLastUsedUpdate(
  tokenRow: ProjectTokenRow,
  req: CheckRequest,
  tenantId: string,
  projectId: string,
): void {
  db.update(project_tokens)
    .set({ last_used_at: new Date() })
    .where(eq(project_tokens.id, tokenRow.id))
    .catch((err) =>
      log.warn("project_token_last_used_update_failed", {
        project_token_id: tokenRow.id,
        tenant_id: tenantId,
        project_id: projectId,
        trace_id: req.trace_id || null,
        ...serializeError(err),
      }),
    );
}

function checkContextEntitledEcosystems(
  checkContext: CheckContext & { entitledEcosystems?: string[] | null },
): string[] | null {
  return checkContext.entitledEcosystems ?? null;
}

async function collectConnectorEvaluationFields(input: {
  req: CheckRequest;
  connectors: PackageIntelligenceConnector[];
  tenantId: string;
  projectId: string;
  artifactIdentity: ArtifactIdentity;
}): Promise<{
  connectorMeta: Record<string, unknown>;
  fields: Record<string, unknown>;
}> {
  const { req, connectors, tenantId, projectId, artifactIdentity } = input;
  const connectorMeta: Record<string, unknown> = {};

  await maybePrefetchContributorSlice(req, connectors);

  for (const connector of connectors) {
    const snapshot = await evaluateConnectorForRequest({
      connector,
      req,
      artifactIdentity,
      tenantId,
      projectId,
    });
    connectorMeta[connector.id] = snapshot.meta;
  }

  const snapshots =
    connectors.length > 0
      ? await loadSnapshots(db, projectId, artifactIdentity, "artifact")
      : [];
  for (const connector of connectors) {
    if (!snapshots.some((snapshot) => snapshot.connectorKey === connector.id)) {
      snapshots.push(unavailableSnapshot(connector.id));
    }
  }

  const packageReleaseContext = await loadPackageReleaseContext(req);

  return {
    connectorMeta,
    fields: resolveFields(snapshots, {
      ecosystem: req.ecosystem,
      pkg: req.package,
      version: req.version,
      versionPublishedAt: packageReleaseContext.versionPublishedAt,
      versionAgeDays: packageReleaseContext.versionAgeDays,
      latestVersionPublishedAt: packageReleaseContext.latestVersionPublishedAt,
    }),
  };
}

async function loadPackageReleaseContext(
  req: CheckRequest,
): Promise<PackageReleaseContext> {
  const empty: PackageReleaseContext = {
    versionPublishedAt: null,
    versionAgeDays: null,
    latestVersionPublishedAt: null,
  };
  const identity = canonicalizePackageIdentity(req);

  if (identity.ecosystem !== "npm" || !identity.version) {
    return empty;
  }

  const [row] = await db
    .select({
      versionPublishedAt: package_versions.published_at,
      latestVersionPublishedAt: latestPackageVersions.published_at,
    })
    .from(package_versions)
    .innerJoin(packages, eq(packages.id, package_versions.package_id))
    .leftJoin(
      latestPackageVersions,
      eq(packages.latest_package_version_id, latestPackageVersions.id),
    )
    .where(
      and(
        eq(packages.ecosystem, identity.ecosystem),
        eq(packages.package, identity.package),
        eq(package_versions.version, identity.version),
      ),
    )
    .limit(1);

  const versionPublishedAt =
    toIsoTimestamp(row?.versionPublishedAt) ??
    contributorRequestedVersionPublishedAt(req, identity.version);
  const latestVersionPublishedAt = toIsoTimestamp(
    row?.latestVersionPublishedAt,
  );

  return {
    versionPublishedAt,
    versionAgeDays: ageDays(versionPublishedAt),
    latestVersionPublishedAt,
  };
}

function contributorRequestedVersionPublishedAt(
  req: CheckRequest,
  version: string,
): string | null {
  if (
    req.contributor_context?.requested_version === version &&
    req.contributor_context.requested_version_published_at
  ) {
    return req.contributor_context.requested_version_published_at;
  }
  return null;
}

function toIsoTimestamp(
  value: Date | string | null | undefined,
): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function ageDays(isoTimestamp: string | null): number | null {
  if (!isoTimestamp) return null;
  const publishedAt = new Date(isoTimestamp).getTime();
  if (Number.isNaN(publishedAt)) return null;
  return Math.max(0, (Date.now() - publishedAt) / 86_400_000);
}

async function maybePrefetchContributorSlice(
  req: CheckRequest,
  connectors: PackageIntelligenceConnector[],
): Promise<void> {
  if (!req.contributor_context) {
    return;
  }

  const contributorConnector = connectors.find(
    (connector): connector is ContributorConnector =>
      connector instanceof ContributorConnector,
  );
  if (!contributorConnector) {
    return;
  }

  const identity = canonicalizePackageIdentity(req);
  if (!identity.version) {
    return;
  }

  const existingSlice = await db
    .select({
      contributor_slice_fingerprint:
        package_versions.contributor_slice_fingerprint,
    })
    .from(package_versions)
    .innerJoin(packages, eq(packages.id, package_versions.package_id))
    .where(
      and(
        eq(packages.ecosystem, identity.ecosystem),
        eq(packages.package, identity.package),
        eq(package_versions.version, identity.version),
      ),
    )
    .limit(1);

  if (
    req.contributor_context.slice_fingerprint &&
    existingSlice[0]?.contributor_slice_fingerprint ===
      req.contributor_context.slice_fingerprint
  ) {
    return;
  }

  await contributorConnector.processPrefetchEvent(
    {
      ecosystem: identity.ecosystem,
      package: identity.package,
      extractedAt: req.contributor_context.slice_extracted_at,
      fingerprint: req.contributor_context.package_metadata_fingerprint,
      packageMetadataFingerprint:
        req.contributor_context.package_metadata_fingerprint,
      sliceFingerprint: req.contributor_context.slice_fingerprint,
      requestedVersion: identity.version,
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

async function evaluateConnectorForRequest(input: {
  connector: PackageIntelligenceConnector;
  req: CheckRequest;
  artifactIdentity: ArtifactIdentity;
  tenantId: string;
  projectId: string;
}) {
  const { connector, req, artifactIdentity, tenantId, projectId } = input;
  const event = buildArtifactRequestEvent({
    artifactIdentity,
    source: "proxy",
    context: {
      tenantId,
      projectId,
      requestId: req.request_id,
      traceId: req.trace_id,
    },
  });
  if (!connectorSupportsEvent(connector, event)) {
    return unavailableSnapshot(connector.id);
  }

  let fetchPromise: Promise<ConnectorEventOutcome> | null = null;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const fetchStartMs = Date.now();

  try {
    const cachedSnapshot = await buildCachedSnapshot(
      db,
      connector,
      event,
      artifactIdentity.display_name,
    );

    if (cachedSnapshot !== null) {
      const { snapshot, findings: cacheFindings } = cachedSnapshot;
      await upsertConnectorSnapshot(db, tenantId, projectId, snapshot);
      await upsertProjectFindingsForEntity(db, {
        tenantId,
        projectId,
        connectorKey: connector.id,
        packageId: snapshot.packageId,
        packageVersionId: snapshot.packageVersionId,
        findings: cacheFindings.map((finding) => ({
          findingId: finding.finding_id,
          severity: finding.severity,
          title: finding.title,
        })),
      });
      return snapshot;
    }

    const packageScopedResult =
      connector.id === "intelligence"
        ? await getPackageScopedCachedResult(
            db,
            connector,
            buildPackageMetadataEvent({
              artifactIdentity,
              source: "proxy",
              context: {
                tenantId,
                projectId,
                requestId: req.request_id,
                traceId: req.trace_id,
              },
            }),
          )
        : null;

    if (packageScopedResult !== null) {
      return persistConnectorResult(
        db,
        connector,
        tenantId,
        projectId,
        event,
        artifactIdentity.display_name,
        packageScopedResult,
        0,
      );
    }

    fetchPromise = connector.handleEvent(event, { tenantId, projectId });
    const responseDeadline = new Promise<never>((_, reject) => {
      deadlineTimer = setTimeout(
        () => reject(new Error("response_timeout")),
        connector.config.responseTimeoutMs,
      );
    });

    const outcome = await Promise.race([fetchPromise, responseDeadline]);
    clearTimeout(deadlineTimer);
    deadlineTimer = undefined;
    const result = connectorResultFromOutcome(outcome);
    if (!result) {
      return unavailableSnapshot(connector.id);
    }

    return persistConnectorResult(
      db,
      connector,
      tenantId,
      projectId,
      event,
      artifactIdentity.display_name,
      result,
      Date.now() - fetchStartMs,
    );
  } catch (err) {
    const isTimeout =
      err instanceof Error && err.message === "response_timeout";
    if (!isTimeout) {
      clearTimeout(deadlineTimer);
      deadlineTimer = undefined;
      log.warn("connector_evaluation_failed", {
        component: "policy_connectors",
        connector: connector.id,
        ecosystem: event.ecosystem,
        package: event.packageName,
        version: event.version,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (isTimeout && fetchPromise !== null) {
      fetchPromise
        .then((bgOutcome) => {
          const bgResult = connectorResultFromOutcome(bgOutcome);
          if (!bgResult) return null;
          return persistConnectorResult(
            db,
            connector,
            tenantId,
            projectId,
            event,
            artifactIdentity.display_name,
            bgResult,
            Date.now() - fetchStartMs,
          );
        })
        .catch((bgErr) =>
          log.warn("background_fetch_failed", {
            component: "policy_connectors",
            connector: connector.id,
            error: bgErr instanceof Error ? bgErr.message : String(bgErr),
          }),
        );
    }

    const failureStatus =
      isTimeout && fetchPromise !== null
        ? "background_pending"
        : isConnectorUnavailableError(err)
          ? "unavailable"
          : "error";
    const errorCode =
      isTimeout && fetchPromise !== null
        ? "response_timeout"
        : err instanceof Error
          ? err.message
          : "unknown";

    const snapshot = connector.normalizeToSnapshot(
      null,
      eventEntityContext(event, artifactIdentity.display_name, {
        isCacheHit: false,
        responseTimeMs: Date.now() - fetchStartMs,
        cacheAgeHours: null,
      }),
      failureStatus,
      errorCode,
    );

    await upsertConnectorSnapshot(db, tenantId, projectId, snapshot);
    return snapshot;
  }
}

function evaluatePolicyDecision(
  rules: Array<{
    id: string | null;
    policyId: string | null;
    name: string;
    policyName: string;
    effectiveEnforcementMode: string;
    condition: Condition;
    action: Record<string, any>;
  }>,
  fields: Record<string, unknown>,
  defaultCacheTtl: number,
  defaultServeMode: ServeMode,
): EvaluatedPolicyDecision {
  let decision = DECISION_ALLOW;
  let reason = "no_match";
  let detail = "No policy rules matched";
  let cacheTtl = defaultCacheTtl;
  let serveMode = defaultServeMode;
  const blockingReasonCodes: string[] = [];
  const collectedViolations: EvaluatedPolicyDecision["collectedViolations"] =
    [];
  let rulesEvaluated = 0;
  let rulesMatched = 0;

  for (const rule of rules) {
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
        detail = message;
        cacheTtl = 0;
        serveMode = ServeMode.UNSPECIFIED;
      }
      decision = DECISION_BLOCK;
      blockingReasonCodes.push(action.code ?? "policy_violation");
    }
  }

  if (decision === DECISION_BLOCK) {
    reason = blockingReasonCodes.join(",");
  } else if (rulesMatched === 0) {
    reason = "allowed";
    detail = "No policy rules matched — package allowed";
  } else {
    reason = "advisory_only";
    detail = "Rules matched in advisory mode only — package allowed";
  }

  return {
    decision,
    reason,
    detail,
    cacheTtl,
    serveMode,
    rulesEvaluated,
    rulesMatched,
    collectedViolations,
  };
}

function warmPackageScopedConnectors(
  artifactIdentity: ArtifactIdentity,
  connectors: PackageIntelligenceConnector[],
  requestContext?: { tenantId?: string; projectId?: string },
): void {
  if (!connectors.some((connector) => connector.id === "intelligence")) {
    return;
  }

  const event = buildPackageMetadataEvent({
    artifactIdentity,
    source: "proxy",
    context: requestContext,
  });
  for (const connector of connectors) {
    if (connector.id !== "intelligence" || !connectorSupportsEvent(connector, event)) {
      continue;
    }

    getPackageScopedCachedResult(db, connector, event)
      .then((cached) => {
        if (cached !== null) {
          return;
        }

        return connector
          .handleEvent(event, requestContext)
          .then((outcome) => {
            const result = connectorResultFromOutcome(outcome);
            if (!result) return null;
            return upsertPackageScopedCachedResult(db, connector, event, result);
          });
      })
      .catch((err) =>
        log.warn("package_scoped_connector_warm_failed", {
          component: "policy_connectors",
          connector: connector.id,
          ecosystem: event.ecosystem,
          package: event.packageName,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
  }
}

async function persistConnectorResult(
  dbHandle: typeof db,
  connector: PackageIntelligenceConnector,
  tenantId: string,
  projectId: string,
  event: ConnectorArtifactEvent,
  displayName: string,
  result: ConnectorResult,
  responseTimeMs: number,
) {
  await upsertCachedResultWithFindings(
    dbHandle,
    connector,
    event,
    result,
  );

  const snapshot = connector.normalizeToSnapshot(
    result,
    eventEntityContext(event, displayName, {
      isCacheHit: false,
      responseTimeMs,
      cacheAgeHours: null,
    }),
  );

  await upsertConnectorSnapshot(dbHandle, tenantId, projectId, snapshot);

  await upsertProjectFindingsForEntity(dbHandle, {
    tenantId,
    projectId,
    connectorKey: connector.id,
    packageId: snapshot.packageId,
    packageVersionId: snapshot.packageVersionId,
    findings: result.findings,
  });

  return snapshot;
}

function connectorResultFromOutcome(
  outcome: ConnectorEventOutcome,
): ConnectorResult | null {
  return outcome.action === "cache_result" ? outcome.result : null;
}

async function recordCheckEvent(opts: {
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
  artifactIdentity: ArtifactIdentity;
  decision: number;
  reason: string;
  serveMode: ServeMode;
  eventId?: string;
  publishToSse?: boolean;
}): Promise<string | null> {
  const eventId = opts.eventId ?? randomUUID();
  const requestedAt = new Date();
  try {
    const values = {
      id: eventId,
      tenant_id: opts.tenant_id,
      project_id: opts.project_id,
      proxy_id: opts.proxy.proxyId,
      ecosystem: opts.artifactIdentity.ecosystem,
      package: opts.artifactIdentity.package,
      version: opts.artifactIdentity.version ?? "",
      package_id: opts.artifactIdentity.package_id,
      package_version_id: opts.artifactIdentity.package_version_id,
      decision: opts.decision === DECISION_ALLOW ? "allow" : "block",
      reason: opts.reason,
      source: "policy_engine" as const,
      event_type: "proxy_request" as const,
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
      raw_identity: opts.artifactIdentity.raw,
      requested_at: requestedAt,
    };

    const rows = opts.publishToSse
      ? await db
          .insert(events)
          .values(values)
          .returning({ created_at: events.created_at })
      : await db.insert(events).values(values);

    if (!opts.publishToSse) {
      return eventId;
    }

    const [inserted] = rows as Array<{ created_at: Date }>;
    const payload: EventPayload = {
      id: eventId,
      tenant_id: opts.tenant_id,
      project_id: opts.project_id ?? "",
      source: "policy_engine",
      event_type: "proxy_request",
      decision_cache: null,
      proxy_id: opts.proxy.proxyId,
      ecosystem: opts.artifactIdentity.ecosystem,
      package: opts.artifactIdentity.package,
      version: opts.artifactIdentity.version ?? "",
      decision: opts.decision === DECISION_ALLOW ? "allow" : "block",
      reason: opts.reason,
      serve_mode:
        opts.decision === DECISION_ALLOW
          ? serveModeToString(opts.serveMode)
          : null,
      bytes_transferred: null,
      trace_id: opts.req.trace_id || null,
      span_id: opts.req.span_id || null,
      request_id: opts.req.request_id || null,
      project_token_id: opts.tokenRow.id,
      client_ip: opts.req.client_ip,
      proxy_ip: opts.req.proxy_ip,
      requested_at: requestedAt.toISOString(),
      created_at: (inserted?.created_at ?? requestedAt).toISOString(),
      cve_severity: null,
      fix_version: null,
    };
    subscriptionManager.publish(opts.tenant_id, payload);
    return eventId;
  } catch (err) {
    log.error(
      opts.publishToSse ? "check_event_insert_failed" : "event_insert_failed",
      {
        trace_id: opts.req.trace_id || null,
        ...serializeError(err),
      },
    );
    return null;
  }
}

function recordPolicyEvaluation(opts: {
  id: string;
  tenant_id: string;
  project_id: string | null;
  artifactIdentity: ArtifactIdentity;
  decision: string;
  policiesEvaluated: number;
  rulesEvaluated: number;
  rulesMatched: number;
  connectorSnapshotMeta: Record<string, unknown>;
  durationMs: number;
  eventId: string | null;
  fieldValuesAtEvaluation: Record<string, unknown>;
}): void {
  Promise.resolve()
    .then(async () => {
      await db.insert(policy_evaluations).values({
        id: opts.id,
        tenant_id: opts.tenant_id,
        project_id: opts.project_id ?? "",
        entity_type: "artifact",
        package_id: opts.artifactIdentity.package_id,
        package_version_id: opts.artifactIdentity.package_version_id,
        decision: opts.decision,
        policies_evaluated: opts.policiesEvaluated,
        rules_evaluated: opts.rulesEvaluated,
        rules_matched: opts.rulesMatched,
        connector_snapshot_meta: opts.connectorSnapshotMeta,
        field_values_at_evaluation: opts.fieldValuesAtEvaluation,
        duration_ms: opts.durationMs,
        event_id: opts.eventId,
        evaluated_at: new Date(),
      });
    })
    .catch((err) =>
      log.error("policy_evaluation_insert_failed", { ...serializeError(err) }),
    );
}

function recordPolicyEvaluationWithViolations(opts: {
  evaluationId: string;
  tenant_id: string;
  project_id: string;
  artifactIdentity: ArtifactIdentity;
  decision: string;
  policiesEvaluated: number;
  rulesEvaluated: number;
  rulesMatched: number;
  connectorSnapshotMeta: Record<string, unknown>;
  durationMs: number;
  eventId: string | null;
  fieldValuesAtEvaluation: Record<string, unknown>;
  collectedViolations: CollectedViolationForWrite[];
}): void {
  Promise.resolve()
    .then(async () => {
      const evaluatedAt = new Date();

      await db.transaction(async (tx) => {
        await tx.insert(policy_evaluations).values({
          id: opts.evaluationId,
          tenant_id: opts.tenant_id,
          project_id: opts.project_id,
          entity_type: "artifact",
          package_id: opts.artifactIdentity.package_id,
          package_version_id: opts.artifactIdentity.package_version_id,
          decision: opts.decision,
          policies_evaluated: opts.policiesEvaluated,
          rules_evaluated: opts.rulesEvaluated,
          rules_matched: opts.rulesMatched,
          connector_snapshot_meta: opts.connectorSnapshotMeta,
          field_values_at_evaluation: opts.fieldValuesAtEvaluation,
          duration_ms: opts.durationMs,
          event_id: opts.eventId,
          evaluated_at: evaluatedAt,
        });

        if (opts.collectedViolations.length === 0) return;

        const suppressed = await tx
          .select({
            rule_id: violation_suppressions.rule_id,
            project_id: violation_suppressions.project_id,
          })
          .from(violation_suppressions)
          .where(
            and(
              eq(violation_suppressions.tenant_id, opts.tenant_id),
              sql`${violation_suppressions.package_id} IS NOT DISTINCT FROM ${opts.artifactIdentity.package_id}`,
              sql`${violation_suppressions.package_version_id} IS NOT DISTINCT FROM ${opts.artifactIdentity.package_version_id}`,
            ),
          );

        const isSuppressed = (violation: {
          rule_id: string | null;
          project_id: string;
        }): boolean =>
          suppressed.some((row) => {
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

        for (const violation of opts.collectedViolations) {
          const suppressedStatus = isSuppressed(violation);
          const packageId = opts.artifactIdentity.package_id;
          const packageVersionId = opts.artifactIdentity.package_version_id;
          const [activeViolation] = await tx
            .select({
              id: violations.id,
              status: violations.status,
            })
            .from(violations)
            .where(
              and(
                eq(violations.tenant_id, violation.tenant_id),
                eq(violations.project_id, violation.project_id),
                eq(violations.entity_type, violation.entity_type),
                sql`${violations.package_id} IS NOT DISTINCT FROM ${packageId}`,
                sql`${violations.package_version_id} IS NOT DISTINCT FROM ${packageVersionId}`,
                sql`${violations.policy_id} IS NOT DISTINCT FROM ${violation.policy_id}`,
                sql`${violations.rule_id} IS NOT DISTINCT FROM ${violation.rule_id}`,
                eq(violations.enforcement_mode, violation.enforcement_mode),
                eq(violations.code, violation.code),
                sql`${violations.status} IN ('open', 'suppressed')`,
              ),
            )
            .orderBy(
              sql`CASE WHEN ${violations.status} = 'suppressed' THEN 0 ELSE 1 END`,
              sql`${violations.last_seen_at} DESC`,
            )
            .limit(1);

          let violationId = activeViolation?.id;

          if (violationId) {
            await tx
              .update(violations)
              .set({
                rule_id: violation.rule_id,
                policy_id: violation.policy_id,
                rule_name: violation.rule_name,
                policy_name: violation.policy_name,
                recommended_remediation: violation.recommended_remediation,
                package_id: packageId,
                package_version_id: packageVersionId,
                severity: violation.severity,
                message: violation.message,
                blocked: violation.blocked,
                status:
                  activeViolation.status === "suppressed" || suppressedStatus
                    ? "suppressed"
                    : "open",
                last_seen_at: violation.evaluated_at,
              })
              .where(eq(violations.id, violationId));
          } else {
            const [createdViolation] = await tx
              .insert(violations)
              .values({
                id: randomUUID(),
                tenant_id: violation.tenant_id,
                project_id: violation.project_id,
                rule_id: violation.rule_id,
                policy_id: violation.policy_id,
                rule_name: violation.rule_name,
                policy_name: violation.policy_name,
                recommended_remediation: violation.recommended_remediation,
                entity_type: violation.entity_type,
                package_id: packageId,
                package_version_id: packageVersionId,
                severity: violation.severity,
                code: violation.code,
                message: violation.message,
                enforcement_mode: violation.enforcement_mode,
                blocked: violation.blocked,
                status: isSuppressed(violation) ? "suppressed" : "open",
                status_note: null,
                first_seen_at: violation.evaluated_at,
                last_seen_at: violation.evaluated_at,
              })
              .returning({ id: violations.id });

            if (!createdViolation) {
              throw new Error("violation_create_failed");
            }
            violationId = createdViolation.id;
          }

          await tx.insert(violation_occurrences).values({
            id: randomUUID(),
            tenant_id: violation.tenant_id,
            project_id: violation.project_id,
            violation_id: violationId,
            evaluation_id: violation.evaluation_id,
          });
        }
      });
    })
    .catch((err) =>
      log.error("policy_evaluation_write_failed", { ...serializeError(err) }),
    );
}
