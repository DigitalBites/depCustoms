import { Code, ConnectError } from "@connectrpc/connect";
import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  events,
  packages,
  package_versions,
  project_package_usage,
  project_tokens,
} from "../db/schema.js";
import { subscriptionManager } from "../sse/subscription-manager.js";
import type { EventPayload } from "../types/event.js";
import { config } from "../config.js";
import { DECISION_ALLOW } from "./shared.js";
import type { VerifiedProxyContext } from "./proxy-context.js";
import {
  canonicalizePackageIdentity,
  packageKey,
  packageVersionKey,
} from "../features/packages/identity.js";

export function assertRecordUsageBatchWithinLimit(eventCount: number): void {
  if (eventCount > config.recordUsageMaxEvents) {
    throw new ConnectError(
      `recordUsage batch exceeds max size of ${config.recordUsageMaxEvents} events`,
      Code.ResourceExhausted,
    );
  }
}

export async function handleRecordUsage(
  proxy: VerifiedProxyContext,
  usageEvents: Array<{
    ecosystem: string;
    package: string;
    version: string;
    decision: number;
    event_type: string;
    decision_cache: boolean;
    requested_at: string;
    project_token_hash: string;
    trace_id: string;
    request_id: string;
    tenant_id: string;
    project_id: string;
    serve_mode: string | null;
    bytes_transferred: number;
    client_ip: string | null;
    duration_ms: number | null;
    decision_path: string | null;
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
      ecosystem: event.ecosystem,
      package: event.package,
      version: event.version,
      decision: event.decision === DECISION_ALLOW ? "allow" : "block",
      source: "proxy" as const,
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
      decision_path: event.decision_path,
      requested_at: new Date(event.requested_at),
    };
  });

  const validRows = rows.filter(
    (row): row is NonNullable<typeof row> => row !== null && !!row.tenant_id,
  );
  if (validRows.length === 0) return { recorded: 0 };

  await db.insert(events).values(validRows);

  await updatePackageUsage(validRows);

  for (const row of validRows) {
    const payload: EventPayload = {
      id: row.id,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      source: "proxy",
      event_type: row.event_type as EventPayload["event_type"],
      decision_cache: row.decision_cache,
      proxy_id: row.proxy_id,
      ecosystem: row.ecosystem,
      package: row.package,
      version: row.version,
      decision: row.decision,
      reason: null,
      serve_mode: row.serve_mode,
      bytes_transferred: row.bytes_transferred,
      trace_id: row.trace_id,
      span_id: null,
      request_id: row.request_id,
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

  return { recorded: validRows.length };
}

type UsageRow = {
  tenant_id: string;
  project_id: string | null;
  ecosystem: string;
  package: string;
  version: string;
  decision: string;
  source: string;
  event_type: string;
};

async function updatePackageUsage(rows: UsageRow[]): Promise<void> {
  const usageRows = rows.filter(
    (row) =>
      row.project_id &&
      row.source === "proxy" &&
      (row.event_type === "artifact" || row.event_type === "upstream_error"),
  );
  if (usageRows.length === 0) return;

  const seenPackages = new Map<
    string,
    { ecosystem: string; package: string }
  >();
  for (const row of usageRows) {
    const identity = canonicalizePackageIdentity(row);
    const key = packageKey(identity);
    if (!seenPackages.has(key)) {
      seenPackages.set(key, {
        ecosystem: identity.ecosystem,
        package: identity.package,
      });
    }
  }

  const packageRows = await db
    .insert(packages)
    .values([...seenPackages.values()])
    .onConflictDoUpdate({
      target: [packages.ecosystem, packages.package],
      set: { updated_at: packages.updated_at },
    })
    .returning({
      id: packages.id,
      ecosystem: packages.ecosystem,
      package: packages.package,
    });

  const packageIdMap = new Map(
    packageRows.map((row) => [packageKey(row), row.id]),
  );

  const seenPackageVersions = new Map<
    string,
    { package_id: string; version: string }
  >();
  for (const row of usageRows) {
    const identity = canonicalizePackageIdentity(row);
    const package_id = packageIdMap.get(packageKey(identity));
    if (!package_id) continue;
    const key = packageVersionKey(package_id, identity.version);
    if (!seenPackageVersions.has(key)) {
      seenPackageVersions.set(key, { package_id, version: identity.version });
    }
  }

  const packageVersionRows = await db
    .insert(package_versions)
    .values([...seenPackageVersions.values()])
    .onConflictDoUpdate({
      target: [package_versions.package_id, package_versions.version],
      set: { updated_at: package_versions.updated_at },
    })
    .returning({
      id: package_versions.id,
      package_id: package_versions.package_id,
      version: package_versions.version,
    });

  const packageVersionIdMap = new Map(
    packageVersionRows.map((row) => [
      packageVersionKey(row.package_id, row.version),
      row.id,
    ]),
  );

  type Delta = {
    tenant_id: string;
    project_id: string;
    package_version_id: string;
    request_count: number;
    allow_count: number;
    block_count: number;
  };
  const deltaMap = new Map<string, Delta>();

  for (const row of usageRows) {
    const identity = canonicalizePackageIdentity(row);
    const package_id = packageIdMap.get(packageKey(identity));
    if (!package_id || !row.project_id) continue;
    const package_version_id = packageVersionIdMap.get(
      packageVersionKey(package_id, identity.version),
    );
    if (!package_version_id) continue;

    const key = `${row.project_id}|${package_version_id}`;
    const isAllow = row.decision === "allow";
    const existing = deltaMap.get(key);
    if (existing) {
      existing.request_count += 1;
      if (isAllow) existing.allow_count += 1;
      else existing.block_count += 1;
    } else {
      deltaMap.set(key, {
        tenant_id: row.tenant_id,
        project_id: row.project_id,
        package_version_id,
        request_count: 1,
        allow_count: isAllow ? 1 : 0,
        block_count: isAllow ? 0 : 1,
      });
    }
  }

  const deltas = [...deltaMap.values()];
  if (deltas.length === 0) return;

  await db
    .insert(project_package_usage)
    .values(deltas)
    .onConflictDoUpdate({
      target: [
        project_package_usage.project_id,
        project_package_usage.package_version_id,
      ],
      set: {
        request_count: sql`${project_package_usage.request_count} + excluded.request_count`,
        allow_count: sql`${project_package_usage.allow_count} + excluded.allow_count`,
        block_count: sql`${project_package_usage.block_count} + excluded.block_count`,
        updated_at: sql`NOW()`,
      },
    });
}
