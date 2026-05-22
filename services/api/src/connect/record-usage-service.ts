import { Code, ConnectError } from "@connectrpc/connect";
import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  events,
  projects,
  project_package_usage,
  project_tokens,
} from "../db/schema.js";
import { subscriptionManager } from "../sse/subscription-manager.js";
import type { EventPayload } from "../types/event.js";
import { config } from "../config.js";
import { DECISION_ALLOW } from "./shared.js";
import type { VerifiedProxyContext } from "./proxy-context.js";
import { resolveArtifactIdentities } from "../features/packages/artifact-identity.js";
import {
  recordObservedPackageVersionRefs,
  recordPackageVersionRelatedVersions,
  type PackageVersionRelatedVersionInput,
} from "../features/packages/catalog-references.js";
import {
  DECISION,
  DECISION_PATHS,
  REQUEST_EVENT_SOURCE,
} from "@customs/shared-constants";
import type {
  Decision,
  DecisionPath,
  RequestEventType,
  ServeMode,
} from "@customs/shared-constants";
import { buildPackageUsageDeltas } from "../features/packages/usage-aggregation.js";
import { log } from "../logger.js";

export function assertRecordUsageBatchWithinLimit(eventCount: number): void {
  if (eventCount > config.recordUsageMaxEvents) {
    throw new ConnectError(
      `recordUsage batch exceeds max size of ${config.recordUsageMaxEvents} events`,
      Code.ResourceExhausted,
    );
  }
}

function normalizeDecisionPath(path: string | null): DecisionPath | null {
  if (!path) return null;
  if (DECISION_PATHS.includes(path as DecisionPath)) {
    return path as DecisionPath;
  }
  throw new ConnectError(
    `unknown decision path: ${path}`,
    Code.InvalidArgument,
  );
}

function dateIsUnsetOrAtOrAfter(value: Date | null | undefined, at: Date) {
  return value === null || value === undefined || at.getTime() <= value.getTime();
}

function fingerprintHash(hash: string): string {
  if (!hash) return "";
  return hash.length <= 12 ? hash : `...${hash.slice(-12)}`;
}

export async function handleRecordUsage(
  proxy: VerifiedProxyContext,
  usageEvents: Array<{
    ecosystem: string;
    package: string;
    version: string;
    decision: number;
    event_type: RequestEventType;
    decision_cache: boolean;
    requested_at: string;
    project_token_hash: string;
    trace_id: string;
    request_id: string;
    tenant_id: string;
    project_id: string;
    serve_mode: ServeMode | null;
    bytes_transferred: number;
    client_ip: string | null;
    duration_ms: number | null;
    decision_path: string | null;
    requested_ref?: string | null;
    resolved_ref?: string | null;
    ref_resolution_source?: string | null;
    related_versions?: PackageVersionRelatedVersionInput[];
  }>,
): Promise<{ recorded: number }> {
  const proxyTenantId = proxy.tenantId;
  if (usageEvents.length === 0) return { recorded: 0 };

  const tokenResolutionMap = new Map<
    string,
    {
      id: string;
      tenant_id: string;
      project_id: string | null;
      revoked_at: Date | null;
      expires_at: Date | null;
      project_effective_to: Date | null;
    }
  >();
  const allTokenHashes = [
    ...new Set(
      usageEvents.map((event) => event.project_token_hash).filter(Boolean),
    ),
  ];
  if (allTokenHashes.length > 0) {
    const tokenRows = await db
      .select({
        id: project_tokens.id,
        token_hash: project_tokens.token_hash,
        tenant_id: project_tokens.tenant_id,
        project_id: project_tokens.project_id,
        revoked_at: project_tokens.revoked_at,
        expires_at: project_tokens.expires_at,
        project_effective_to: projects.effective_to,
      })
      .from(project_tokens)
      .leftJoin(projects, sql`${projects.id} = ${project_tokens.project_id}`)
      .where(inArray(project_tokens.token_hash, allTokenHashes));
    const hashToRow = new Map(tokenRows.map((row) => [row.token_hash, row]));
    for (const hash of allTokenHashes) {
      const row = hashToRow.get(hash);
      if (row) {
        tokenResolutionMap.set(hash, {
          id: row.id,
          tenant_id: row.tenant_id,
          project_id: row.project_id,
          revoked_at: row.revoked_at,
          expires_at: row.expires_at,
          project_effective_to: row.project_effective_to,
        });
      }
    }
  }

  const fallbackProjectIds = [
    ...new Set(
      usageEvents
        .filter((event) => !tokenResolutionMap.has(event.project_token_hash))
        .map((event) => event.project_id)
        .filter(Boolean),
    ),
  ];
  const fallbackProjectTenantMap = new Map<string, string>();
  if (fallbackProjectIds.length > 0) {
    const fallbackProjectRows = await db
      .select({
        id: projects.id,
        tenant_id: projects.tenant_id,
      })
      .from(projects)
      .where(inArray(projects.id, fallbackProjectIds));
    for (const project of fallbackProjectRows) {
      fallbackProjectTenantMap.set(project.id, project.tenant_id);
    }
  }

  const rows = usageEvents.map((event, index) => {
    const resolved = tokenResolutionMap.get(event.project_token_hash);
    const requestedAt = new Date(event.requested_at);
    const tokenWasValidAtRequest =
      resolved !== undefined &&
      (dateIsUnsetOrAtOrAfter(resolved.revoked_at, requestedAt) &&
        dateIsUnsetOrAtOrAfter(resolved.expires_at, requestedAt) &&
        dateIsUnsetOrAtOrAfter(resolved.project_effective_to, requestedAt));
    let tenant_id = "";
    let project_id: string | null = null;
    const project_token_id =
      resolved && tokenWasValidAtRequest ? resolved.id : null;

    if (resolved && tokenWasValidAtRequest) {
      tenant_id = resolved.tenant_id;
      project_id = resolved.project_id || null;
    } else if (resolved && !tokenWasValidAtRequest) {
      log.warn("record_usage_event_skipped", {
        reason: "resolved_token_not_valid_at_request",
        proxy_id: proxy.proxyId,
        proxy_tenant_id: proxyTenantId,
        token_hash: fingerprintHash(event.project_token_hash),
        event_index: index,
        ecosystem: event.ecosystem,
        package: event.package,
        version: event.version,
      });
      return null;
    } else {
      log.warn("record_usage_token_unresolved", {
        proxy_id: proxy.proxyId,
        proxy_tenant_id: proxyTenantId,
        hinted_tenant_id: event.tenant_id || null,
        hinted_project_id: event.project_id || null,
        token_hash: fingerprintHash(event.project_token_hash),
        event_index: index,
        ecosystem: event.ecosystem,
        package: event.package,
        version: event.version,
      });

      if (!event.tenant_id || event.tenant_id !== proxyTenantId) {
        log.warn("record_usage_event_skipped", {
          reason: "fallback_tenant_mismatch",
          proxy_id: proxy.proxyId,
          proxy_tenant_id: proxyTenantId,
          hinted_tenant_id: event.tenant_id || null,
          hinted_project_id: event.project_id || null,
          token_hash: fingerprintHash(event.project_token_hash),
          event_index: index,
        });
        return null;
      }

      const projectTenantId = event.project_id
        ? fallbackProjectTenantMap.get(event.project_id)
        : undefined;
      if (!event.project_id || projectTenantId !== proxyTenantId) {
        log.warn("record_usage_event_skipped", {
          reason: "fallback_project_not_in_proxy_tenant",
          proxy_id: proxy.proxyId,
          proxy_tenant_id: proxyTenantId,
          hinted_tenant_id: event.tenant_id || null,
          hinted_project_id: event.project_id || null,
          project_tenant_id: projectTenantId || null,
          token_hash: fingerprintHash(event.project_token_hash),
          event_index: index,
        });
        return null;
      }

      tenant_id = event.tenant_id;
      project_id = event.project_id;
    }

    if (tenant_id !== proxyTenantId) {
      log.warn("record_usage_event_skipped", {
        reason: "resolved_tenant_mismatch",
        proxy_id: proxy.proxyId,
        proxy_tenant_id: proxyTenantId,
        resolved_tenant_id: tenant_id,
        resolved_project_id: project_id,
        token_hash: fingerprintHash(event.project_token_hash),
        event_index: index,
      });
      return null;
    }

    return {
      id: randomUUID(),
      tenant_id,
      project_id,
      proxy_id: proxy.proxyId,
      input_ecosystem: event.ecosystem,
      input_package: event.package,
      input_version: event.version,
      decision:
        event.decision === DECISION_ALLOW ? DECISION.ALLOW : DECISION.BLOCK,
      source: REQUEST_EVENT_SOURCE.PROXY,
      event_type: event.event_type,
      decision_cache: event.decision_cache,
      trace_id: event.trace_id || null,
      request_id: event.request_id || null,
      serve_mode: event.serve_mode || null,
      bytes_transferred: event.bytes_transferred,
      project_token_id,
      client_ip: event.client_ip,
      proxy_ip: proxy.proxyIp,
      duration_ms: event.duration_ms,
      decision_path: normalizeDecisionPath(event.decision_path),
      requested_ref: event.requested_ref || null,
      resolved_ref: event.resolved_ref || null,
      ref_resolution_source: event.ref_resolution_source || null,
      related_versions: event.related_versions,
      requested_at: requestedAt,
    };
  });

  const validRows = rows.filter(
    (row): row is NonNullable<typeof row> => row !== null && !!row.tenant_id,
  );
  if (validRows.length === 0) {
    return { recorded: usageEvents.length };
  }

  const artifactIdentities = await resolveArtifactIdentities(
    db,
    validRows.map((row) => ({
      ecosystem: row.input_ecosystem,
      package: row.input_package,
      version: row.input_version,
      source: "record_usage",
    })),
  );
  const eventRows = validRows.map((row, index) => ({
    id: row.id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    proxy_id: row.proxy_id,
    decision: row.decision,
    source: row.source,
    event_type: row.event_type,
    decision_cache: row.decision_cache,
    trace_id: row.trace_id,
    request_id: row.request_id,
    serve_mode: row.serve_mode,
    bytes_transferred: row.bytes_transferred,
    project_token_id: row.project_token_id,
    client_ip: row.client_ip,
    proxy_ip: row.proxy_ip,
    duration_ms: row.duration_ms,
    decision_path: row.decision_path,
    requested_at: row.requested_at,
    package_id: artifactIdentities[index]?.package_id ?? null,
    package_version_id: artifactIdentities[index]?.package_version_id ?? null,
    raw_identity: artifactIdentities[index]?.raw ?? null,
    requested_ref: row.requested_ref,
    resolved_ref: row.resolved_ref,
    ref_resolution_source: row.ref_resolution_source,
  }));

  for (const [index, row] of validRows.entries()) {
    const identity = artifactIdentities[index];
    if (row.requested_ref) {
      await recordObservedPackageVersionRefs(db, {
        ecosystem: identity?.ecosystem ?? row.input_ecosystem,
        package_id: identity?.package_id ?? null,
        package_version_id: identity?.package_version_id ?? null,
        version: identity?.version ?? row.input_version,
        requested_ref: row.requested_ref,
        resolved_ref: row.resolved_ref,
        ref_resolution_source: row.ref_resolution_source,
        observed_at: row.requested_at,
      });
    }
    await recordPackageVersionRelatedVersions(db, {
      ecosystem: identity?.ecosystem ?? row.input_ecosystem,
      package: identity?.package ?? row.input_package,
      package_id: identity?.package_id ?? null,
      package_version_id: identity?.package_version_id ?? null,
      related_versions: row.related_versions,
      observed_at: row.requested_at,
    });
  }

  await db.insert(events).values(eventRows);

  await updatePackageUsage(eventRows);

  for (const [index, row] of validRows.entries()) {
    const identity = artifactIdentities[index];
    const payload: EventPayload = {
      id: row.id,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      source: REQUEST_EVENT_SOURCE.PROXY,
      event_type: row.event_type,
      decision_cache: row.decision_cache,
      proxy_id: row.proxy_id,
      ecosystem: identity?.ecosystem ?? row.input_ecosystem,
      package: identity?.package ?? row.input_package,
      version: identity?.version ?? row.input_version,
      decision: row.decision,
      reason: null,
      serve_mode: row.serve_mode,
      bytes_transferred: row.bytes_transferred,
      trace_id: row.trace_id,
      span_id: null,
      request_id: row.request_id,
      requested_ref: row.requested_ref,
      resolved_ref: row.resolved_ref,
      ref_resolution_source: row.ref_resolution_source,
      project_token_id: row.project_token_id,
      client_ip: row.client_ip,
      proxy_ip: row.proxy_ip,
      requested_at: row.requested_at.toISOString(),
      created_at: new Date().toISOString(),
      cve_severity: null,
      fix_version: null,
    };
    subscriptionManager.publish(row.tenant_id, payload);
  }

  return { recorded: usageEvents.length };
}

type UsageRow = {
  tenant_id: string;
  project_id: string | null;
  package_version_id: string | null;
  decision: Decision;
  source: typeof REQUEST_EVENT_SOURCE.PROXY;
  event_type: RequestEventType;
  requested_ref?: string | null;
  resolved_ref?: string | null;
  requested_at?: Date;
};

async function updatePackageUsage(rows: UsageRow[]): Promise<void> {
  const deltas = await buildPackageUsageDeltas(db, rows);
  if (deltas.length === 0) return;

  await db
    .insert(project_package_usage)
    .values(
      deltas.map((delta) => ({
        tenant_id: delta.tenant_id,
        project_id: delta.project_id,
        package_version_id: delta.package_version_id,
        request_count: delta.request_count,
        allow_count: delta.allow_count,
        block_count: delta.block_count,
        created_at: delta.first_seen_at,
        updated_at: delta.last_seen_at,
      })),
    )
    .onConflictDoUpdate({
      target: [
        project_package_usage.project_id,
        project_package_usage.package_version_id,
      ],
      set: {
        request_count: sql`${project_package_usage.request_count} + excluded.request_count`,
        allow_count: sql`${project_package_usage.allow_count} + excluded.allow_count`,
        block_count: sql`${project_package_usage.block_count} + excluded.block_count`,
        updated_at: sql`GREATEST(${project_package_usage.updated_at}, excluded.updated_at)`,
      },
    });
}
