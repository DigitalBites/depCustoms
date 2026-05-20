import { Code, ConnectError } from "@connectrpc/connect";
import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { events, project_package_usage, project_tokens } from "../db/schema.js";
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
    { id: string; tenant_id: string; project_id: string | null }
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
      })
      .from(project_tokens)
      .where(inArray(project_tokens.token_hash, allTokenHashes));
    const hashToRow = new Map(tokenRows.map((row) => [row.token_hash, row]));
    for (const hash of allTokenHashes) {
      const row = hashToRow.get(hash);
      if (row) {
        tokenResolutionMap.set(hash, {
          id: row.id,
          tenant_id: row.tenant_id,
          project_id: row.project_id,
        });
      }
    }
  }

  const rows = usageEvents.map((event) => {
    const resolved = tokenResolutionMap.get(event.project_token_hash);
    const tenant_id = resolved?.tenant_id ?? event.tenant_id;
    const project_id = (resolved?.project_id ?? event.project_id) || null;
    const project_token_id = resolved?.id ?? null;

    if (tenant_id && tenant_id !== proxyTenantId) return null;

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
      requested_at: new Date(event.requested_at),
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
