import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db/index.js";
import {
  events,
  policy_evaluations,
  proxies,
  proxy_metadata_cache_stats,
} from "../db/schema.js";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";
import { getAuthContext, requireTenantCapability } from "../http/guards.js";

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

// ---------------------------------------------------------------------------
// GET /v1/performance?window=1h|24h|7d
// Returns proxy latency stats (per proxy) and rules engine eval stats
// (consolidated). Only source='proxy' events carry duration_ms and
// decision_path; policy_engine events are excluded from proxy metrics.
// ---------------------------------------------------------------------------
performanceRouter.get(
  "/v1/performance",
  zValidator("query", querySchema),
  async (c) => {
    if (
      !requireTenantCapability(
        c,
        "performance.read",
        "You do not have access to view performance metrics",
      )
    ) {
      return c.res;
    }
    const { tenantId } = getAuthContext(c);

    const { window } = c.req.valid("query");
    const cutoff = windowCutoff(window);
    const cutoffIso = cutoff.toISOString();

    // Fetch all registered proxies for this tenant to get display names.
    // Proxies are always a small set, so fetching all is fine.
    const registeredProxies = await db
      .select({ proxy_id: proxies.proxy_id, name: proxies.name })
      .from(proxies)
      .where(eq(proxies.tenant_id, tenantId));

    const nameByProxyId = Object.fromEntries(
      registeredProxies.map((p) => [p.proxy_id, p.name]),
    );

    // ---------------------------------------------------------------------------
    // Proxy latency metrics — grouped per proxy_id
    // Only source='proxy' events carry decision_path and duration_ms.
    // FILTER clauses let us compute per-path aggregates in a single pass.
    // ---------------------------------------------------------------------------
    const proxyRows = await db
      .select({
        proxy_id: events.proxy_id,
        // Count all events with timing data (duration_ms may be null on very old
        // proxy versions even when decision_path is set — count those separately).
        tracked: sql<number>`count(*) filter (where ${events.duration_ms} is not null)`,
        cache_hits: sql<number>`count(*) filter (where ${events.decision_path} = 'cache_hit')`,
        cache_misses: sql<number>`count(*) filter (where ${events.decision_path} = 'check')`,
        unavailable: sql<number>`count(*) filter (where ${events.decision_path} = 'control_plane_unavailable')`,
        // Percentiles across all decisions with timing data
        p50_ms: sql<
          number | null
        >`percentile_cont(0.50) within group (order by ${events.duration_ms}) filter (where ${events.duration_ms} is not null)`,
        p95_ms: sql<
          number | null
        >`percentile_cont(0.95) within group (order by ${events.duration_ms}) filter (where ${events.duration_ms} is not null)`,
        p99_ms: sql<
          number | null
        >`percentile_cont(0.99) within group (order by ${events.duration_ms}) filter (where ${events.duration_ms} is not null)`,
        // Per-path averages for latency breakdown
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

    // ---------------------------------------------------------------------------
    // Rules engine metrics — consolidated across all projects
    // policy_evaluations.duration_ms is the time the policy engine itself took
    // (connector lookups, rule evaluation) — independent of proxy-side latency.
    // ---------------------------------------------------------------------------
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
        cache_hits: sql<string>`count(*) filter (
        where coalesce(
          nullif((connector_metric_source.connector_value::jsonb)->>'isCacheHit', '')::boolean,
          nullif((connector_metric_source.connector_value::jsonb)->>'is_cache_hit', '')::boolean,
          false
        )
      )::text`,
        cache_misses: sql<string>`count(*) filter (
        where not coalesce(
          nullif((connector_metric_source.connector_value::jsonb)->>'isCacheHit', '')::boolean,
          nullif((connector_metric_source.connector_value::jsonb)->>'is_cache_hit', '')::boolean,
          false
        )
      )::text`,
        ok_count: sql<string>`count(*) filter (
        where coalesce(
          (connector_metric_source.connector_value::jsonb)->>'status',
          (connector_metric_source.connector_value::jsonb)->>'_meta.status'
        ) = 'ok'
      )::text`,
        timeout_count: sql<string>`count(*) filter (
        where coalesce(
          (connector_metric_source.connector_value::jsonb)->>'status',
          (connector_metric_source.connector_value::jsonb)->>'_meta.status'
        ) = 'timeout'
      )::text`,
        background_pending_count: sql<string>`count(*) filter (
        where coalesce(
          (connector_metric_source.connector_value::jsonb)->>'status',
          (connector_metric_source.connector_value::jsonb)->>'_meta.status'
        ) = 'background_pending'
      )::text`,
        error_count: sql<string>`count(*) filter (
        where coalesce(
          (connector_metric_source.connector_value::jsonb)->>'status',
          (connector_metric_source.connector_value::jsonb)->>'_meta.status'
        ) = 'error'
      )::text`,
        unavailable_count: sql<string>`count(*) filter (
        where coalesce(
          (connector_metric_source.connector_value::jsonb)->>'status',
          (connector_metric_source.connector_value::jsonb)->>'_meta.status'
        ) = 'unavailable'
      )::text`,
        avg_response_ms: sql<string | null>`avg(
        nullif(
          coalesce(
            (connector_metric_source.connector_value::jsonb)->>'responseTimeMs',
            (connector_metric_source.connector_value::jsonb)->>'response_time_ms'
          ),
          ''
        )::numeric
      ) filter (
        where not coalesce(
          nullif((connector_metric_source.connector_value::jsonb)->>'isCacheHit', '')::boolean,
          nullif((connector_metric_source.connector_value::jsonb)->>'is_cache_hit', '')::boolean,
          false
        )
      )::text`,
        p95_response_ms: sql<string | null>`percentile_cont(0.95) within group (
        order by nullif(
          coalesce(
            (connector_metric_source.connector_value::jsonb)->>'responseTimeMs',
            (connector_metric_source.connector_value::jsonb)->>'response_time_ms'
          ),
          ''
        )::numeric
      ) filter (
        where not coalesce(
          nullif((connector_metric_source.connector_value::jsonb)->>'isCacheHit', '')::boolean,
          nullif((connector_metric_source.connector_value::jsonb)->>'is_cache_hit', '')::boolean,
          false
        )
      )::text`,
        avg_cache_age_hours: sql<string | null>`avg(
        nullif(
          coalesce(
            (connector_metric_source.connector_value::jsonb)->>'cacheAgeHours',
            (connector_metric_source.connector_value::jsonb)->>'cache_age_hours'
          ),
          ''
        )::numeric
      ) filter (
        where coalesce(
          nullif((connector_metric_source.connector_value::jsonb)->>'isCacheHit', '')::boolean,
          nullif((connector_metric_source.connector_value::jsonb)->>'is_cache_hit', '')::boolean,
          false
        )
      )::text`,
      })
      .from(connectorMetricSource)
      .groupBy(sql`connector_metric_source.connector_key`)
      .orderBy(sql`connector_metric_source.connector_key`);

    const connectorMetrics = (
      connectorRows as unknown as ConnectorMetricsRow[]
    ).map((row) => {
      const totalChecks = Number(row.total_checks ?? 0);
      const cacheHits = Number(row.cache_hits ?? 0);
      const cacheMisses = Number(row.cache_misses ?? 0);
      return {
        connector_key: row.connector_key,
        total_checks: totalChecks,
        cache_hits: cacheHits,
        cache_misses: cacheMisses,
        cache_hit_rate:
          totalChecks > 0 ? Math.round((cacheHits / totalChecks) * 100) : 0,
        ok_count: Number(row.ok_count ?? 0),
        timeout_count: Number(row.timeout_count ?? 0),
        background_pending_count: Number(row.background_pending_count ?? 0),
        error_count: Number(row.error_count ?? 0),
        unavailable_count: Number(row.unavailable_count ?? 0),
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
            ? Math.round(Number(row.avg_cache_age_hours) * 10) / 10
            : null,
      };
    });

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
          gte(proxy_metadata_cache_stats.window_ended_at, cutoff),
        ),
      )
      .groupBy(
        proxy_metadata_cache_stats.proxy_id,
        proxy_metadata_cache_stats.ecosystem,
      )
      .orderBy(
        proxy_metadata_cache_stats.proxy_id,
        proxy_metadata_cache_stats.ecosystem,
      );

    const metadataCacheMetrics = (
      metadataCacheRows as unknown as MetadataCacheMetricsRow[]
    ).map((row) => {
      const hits = Number(row.hits ?? 0);
      const misses = Number(row.misses ?? 0);
      const staleHits = Number(row.stale_hits ?? 0);
      const totalLookups = hits + misses + staleHits;

      return {
        proxy_id: row.proxy_id,
        proxy_name: nameByProxyId[row.proxy_id] ?? row.proxy_id,
        ecosystem: row.ecosystem,
        hits,
        misses,
        stale_hits: staleHits,
        refreshes: Number(row.refreshes ?? 0),
        parse_failures: Number(row.parse_failures ?? 0),
        store_failures: Number(row.store_failures ?? 0),
        hit_rate:
          totalLookups > 0 ? Math.round((hits / totalLookups) * 100) : 0,
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
