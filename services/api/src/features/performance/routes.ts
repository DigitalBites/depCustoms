import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db } from "../../db/index.js";
import {
  events,
  policy_evaluations,
  proxies,
  proxy_metadata_cache_stats,
} from "../../db/schema.js";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { authMiddleware } from "../../middleware/auth.js";
import { getAuthContext, requireTenantCapability } from "../../http/guards.js";

export const performanceRouter = new Hono();

performanceRouter.use("*", authMiddleware);

const querySchema = z.object({
  window: z.enum(["1h", "24h", "7d"]).default("1h"),
});

function windowCutoff(w: "1h" | "24h" | "7d"): Date {
  const ms = { "1h": 3_600_000, "24h": 86_400_000, "7d": 604_800_000 }[w];
  return new Date(Date.now() - ms);
}

type ConnectorMetricsRow = {
  connector_key: string;
  total_checks: string;
  cache_hits: string;
  cache_misses: string;
  ok_count: string;
  timeout_count: string;
  background_pending_count: string;
  error_count: string;
  unavailable_count: string;
  avg_response_ms: string | null;
  p95_response_ms: string | null;
  avg_cache_age_hours: string | null;
};

type MetadataCacheMetricsRow = {
  proxy_id: string;
  ecosystem: string;
  hits: string;
  misses: string;
  stale_hits: string;
  refreshes: string;
  parse_failures: string;
  store_failures: string;
};

performanceRouter.get(
  "/v1/performance",
  zValidator("query", querySchema),
  async (c) => {
    const capabilityResult = requireTenantCapability(
      c,
      "performance.read",
      "You do not have access to view performance metrics",
    );
    if (!capabilityResult.ok) {
      return capabilityResult.response;
    }
    const { tenantId } = getAuthContext(c);

    const { window } = c.req.valid("query");
    const cutoff = windowCutoff(window);
    const cutoffIso = cutoff.toISOString();

    const registeredProxies = await db
      .select({ proxy_id: proxies.proxy_id, name: proxies.name })
      .from(proxies)
      .where(eq(proxies.tenant_id, tenantId));

    const nameByProxyId = Object.fromEntries(
      registeredProxies.map((p) => [p.proxy_id, p.name]),
    );

    const proxyRows = await db
      .select({
        proxy_id: events.proxy_id,
        tracked: sql<number>`count(*) filter (where ${events.duration_ms} is not null)`,
        cache_hits: sql<number>`count(*) filter (where ${events.decision_path} = 'cache_hit')`,
        cache_misses: sql<number>`count(*) filter (where ${events.decision_path} = 'check')`,
        unavailable: sql<number>`count(*) filter (where ${events.decision_path} = 'control_plane_unavailable')`,
        p50_ms: sql<
          number | null
        >`percentile_cont(0.50) within group (order by ${events.duration_ms}) filter (where ${events.duration_ms} is not null)`,
        p95_ms: sql<
          number | null
        >`percentile_cont(0.95) within group (order by ${events.duration_ms}) filter (where ${events.duration_ms} is not null)`,
        p99_ms: sql<
          number | null
        >`percentile_cont(0.99) within group (order by ${events.duration_ms}) filter (where ${events.duration_ms} is not null)`,
        avg_cache_ms: sql<
          number | null
        >`avg(${events.duration_ms}) filter (where ${events.decision_path} = 'cache_hit'  and ${events.duration_ms} is not null)`,
        avg_check_ms: sql<
          number | null
        >`avg(${events.duration_ms}) filter (where ${events.decision_path} = 'check'      and ${events.duration_ms} is not null)`,
      })
      .from(events)
      .where(
        and(
          eq(events.tenant_id, tenantId),
          eq(events.source, "proxy"),
          gte(events.requested_at, cutoff),
          isNotNull(events.decision_path),
        ),
      )
      .groupBy(events.proxy_id);

    const proxyMetrics = proxyRows.map((r) => {
      const hits = Number(r.cache_hits);
      const misses = Number(r.cache_misses);
      const unav = Number(r.unavailable);
      const totalPath = hits + misses + unav;
      return {
        proxy_id: r.proxy_id,
        proxy_name: nameByProxyId[r.proxy_id] ?? r.proxy_id,
        tracked: Number(r.tracked),
        cache_hits: hits,
        cache_misses: misses,
        unavailable: unav,
        cache_hit_rate:
          totalPath > 0 ? Math.round((hits / totalPath) * 100) : 0,
        p50_ms: r.p50_ms !== null ? Math.round(Number(r.p50_ms)) : null,
        p95_ms: r.p95_ms !== null ? Math.round(Number(r.p95_ms)) : null,
        p99_ms: r.p99_ms !== null ? Math.round(Number(r.p99_ms)) : null,
        avg_cache_ms:
          r.avg_cache_ms !== null ? Math.round(Number(r.avg_cache_ms)) : null,
        avg_check_ms:
          r.avg_check_ms !== null ? Math.round(Number(r.avg_check_ms)) : null,
      };
    });

    const [engineRow] = await db
      .select({
        total_evals: sql<number>`count(*)`,
        p50_ms: sql<
          number | null
        >`percentile_cont(0.50) within group (order by ${policy_evaluations.duration_ms})`,
        p95_ms: sql<
          number | null
        >`percentile_cont(0.95) within group (order by ${policy_evaluations.duration_ms})`,
        p99_ms: sql<
          number | null
        >`percentile_cont(0.99) within group (order by ${policy_evaluations.duration_ms})`,
        avg_ms: sql<number | null>`avg(${policy_evaluations.duration_ms})`,
      })
      .from(policy_evaluations)
      .where(
        and(
          eq(policy_evaluations.tenant_id, tenantId),
          gte(policy_evaluations.evaluated_at, cutoff),
          isNotNull(policy_evaluations.duration_ms),
        ),
      );

    const engineMetrics = {
      total_evals: Number(engineRow?.total_evals ?? 0),
      p50_ms:
        engineRow?.p50_ms !== null
          ? Math.round(Number(engineRow.p50_ms))
          : null,
      p95_ms:
        engineRow?.p95_ms !== null
          ? Math.round(Number(engineRow.p95_ms))
          : null,
      p99_ms:
        engineRow?.p99_ms !== null
          ? Math.round(Number(engineRow.p99_ms))
          : null,
      avg_ms:
        engineRow?.avg_ms !== null
          ? Math.round(Number(engineRow.avg_ms))
          : null,
    };

    const connectorMetricSource = sql<{
      connector_key: string;
      connector_value: unknown;
    }>`(
    SELECT
      meta_entry.key AS connector_key,
      meta_entry.value AS connector_value
    FROM ${policy_evaluations}
    CROSS JOIN LATERAL jsonb_each(${policy_evaluations.connector_snapshot_meta}) AS meta_entry(key, value)
    WHERE ${policy_evaluations.tenant_id} = ${tenantId}
      AND ${policy_evaluations.evaluated_at} >= ${cutoffIso}
  ) AS connector_metric_source`;

    const connectorRows = await db
      .select({
        connector_key: sql<string>`connector_metric_source.connector_key`,
        total_checks: sql<string>`count(*)::text`,
        cache_hits: sql<string>`count(*) filter (where connector_metric_source.connector_value->'meta'->>'status' = 'cache_hit')::text`,
        cache_misses: sql<string>`count(*) filter (where connector_metric_source.connector_value->'meta'->>'status' = 'live')::text`,
        ok_count: sql<string>`count(*) filter (where connector_metric_source.connector_value->'meta'->>'failureStatus' is null)::text`,
        timeout_count: sql<string>`count(*) filter (where connector_metric_source.connector_value->'meta'->>'errorCode' = 'response_timeout')::text`,
        background_pending_count: sql<string>`count(*) filter (where connector_metric_source.connector_value->'meta'->>'failureStatus' = 'background_pending')::text`,
        error_count: sql<string>`count(*) filter (where connector_metric_source.connector_value->'meta'->>'failureStatus' = 'error')::text`,
        unavailable_count: sql<string>`count(*) filter (where connector_metric_source.connector_value->'meta'->>'failureStatus' = 'unavailable')::text`,
        avg_response_ms: sql<string | null>`avg((connector_metric_source.connector_value->'meta'->>'responseTimeMs')::numeric)::text`,
        p95_response_ms: sql<string | null>`percentile_cont(0.95) within group (order by (connector_metric_source.connector_value->'meta'->>'responseTimeMs')::numeric)::text`,
        avg_cache_age_hours: sql<string | null>`avg((connector_metric_source.connector_value->'meta'->>'cacheAgeHours')::numeric) filter (where connector_metric_source.connector_value->'meta'->>'cacheAgeHours' is not null)::text`,
      })
      .from(connectorMetricSource)
      .groupBy(sql`connector_metric_source.connector_key`);

    const connectorMetrics = (connectorRows as ConnectorMetricsRow[]).map(
      (row) => {
        const cacheHits = Number(row.cache_hits);
        const totalChecks = Number(row.total_checks);
        return {
          connector_key: row.connector_key,
          total_checks: totalChecks,
          cache_hits: cacheHits,
          cache_misses: Number(row.cache_misses),
          cache_hit_rate:
            totalChecks > 0 ? Math.round((cacheHits / totalChecks) * 100) : 0,
          ok_count: Number(row.ok_count),
          timeout_count: Number(row.timeout_count),
          background_pending_count: Number(row.background_pending_count),
          error_count: Number(row.error_count),
          unavailable_count: Number(row.unavailable_count),
          avg_response_ms:
            row.avg_response_ms !== null
              ? Math.round(Number(row.avg_response_ms))
              : null,
          p95_response_ms:
            row.p95_response_ms !== null
              ? Math.round(Number(row.p95_response_ms))
              : null,
          avg_cache_age_hours:
            row.avg_cache_age_hours !== null
              ? Number(row.avg_cache_age_hours)
              : null,
        };
      },
    );

    const metadataCacheRows = await db
      .select({
        proxy_id: proxy_metadata_cache_stats.proxy_id,
        ecosystem: proxy_metadata_cache_stats.ecosystem,
        hits: sql<string>`sum(${proxy_metadata_cache_stats.hits})::text`,
        misses: sql<string>`sum(${proxy_metadata_cache_stats.misses})::text`,
        stale_hits: sql<string>`sum(${proxy_metadata_cache_stats.stale_hits})::text`,
        refreshes: sql<string>`sum(${proxy_metadata_cache_stats.refreshes})::text`,
        parse_failures: sql<string>`sum(${proxy_metadata_cache_stats.parse_failures})::text`,
        store_failures: sql<string>`sum(${proxy_metadata_cache_stats.store_failures})::text`,
      })
      .from(proxy_metadata_cache_stats)
      .where(
        and(
          eq(proxy_metadata_cache_stats.tenant_id, tenantId),
          gte(proxy_metadata_cache_stats.bucket_start, cutoff),
        ),
      )
      .groupBy(
        proxy_metadata_cache_stats.proxy_id,
        proxy_metadata_cache_stats.ecosystem,
      );

    const metadataCacheMetrics = (
      metadataCacheRows as MetadataCacheMetricsRow[]
    ).map((row) => {
      const hits = Number(row.hits);
      const misses = Number(row.misses);
      const total = hits + misses + Number(row.stale_hits);
      return {
        proxy_id: row.proxy_id,
        proxy_name: nameByProxyId[row.proxy_id] ?? row.proxy_id,
        ecosystem: row.ecosystem,
        hits,
        misses,
        hit_rate: total > 0 ? Math.round((hits / total) * 100) : 0,
        stale_hits: Number(row.stale_hits),
        refreshes: Number(row.refreshes),
        parse_failures: Number(row.parse_failures),
        store_failures: Number(row.store_failures),
      };
    });

    return c.json({
      window,
      proxyMetrics,
      engineMetrics,
      connectorMetrics,
      metadataCacheMetrics,
    });
  },
);
