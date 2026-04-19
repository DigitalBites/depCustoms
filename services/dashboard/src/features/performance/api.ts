import { apiFetch } from "@/lib/api";
import type {
  PerformanceData,
  PerformanceWindow,
} from "@/features/performance/types";

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePerformanceData(
  value: unknown,
  window: PerformanceWindow,
): PerformanceData {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  return {
    window:
      record.window === "1h" ||
      record.window === "24h" ||
      record.window === "7d"
        ? record.window
        : window,
    proxyMetrics: Array.isArray(record.proxyMetrics)
      ? record.proxyMetrics.map((item) => {
          const metric =
            item && typeof item === "object"
              ? (item as Record<string, unknown>)
              : {};
          return {
            proxy_id:
              typeof metric.proxy_id === "string" ? metric.proxy_id : "",
            proxy_name:
              typeof metric.proxy_name === "string"
                ? metric.proxy_name
                : "Unknown proxy",
            tracked: asNumber(metric.tracked),
            cache_hits: asNumber(metric.cache_hits),
            cache_misses: asNumber(metric.cache_misses),
            unavailable: asNumber(metric.unavailable),
            cache_hit_rate: asNumber(metric.cache_hit_rate),
            p50_ms: asNullableNumber(metric.p50_ms),
            p95_ms: asNullableNumber(metric.p95_ms),
            p99_ms: asNullableNumber(metric.p99_ms),
            avg_cache_ms: asNullableNumber(metric.avg_cache_ms),
            avg_check_ms: asNullableNumber(metric.avg_check_ms),
          };
        })
      : [],
    engineMetrics:
      record.engineMetrics && typeof record.engineMetrics === "object"
        ? {
            total_evals: asNumber(
              (record.engineMetrics as Record<string, unknown>).total_evals,
            ),
            p50_ms: asNullableNumber(
              (record.engineMetrics as Record<string, unknown>).p50_ms,
            ),
            p95_ms: asNullableNumber(
              (record.engineMetrics as Record<string, unknown>).p95_ms,
            ),
            p99_ms: asNullableNumber(
              (record.engineMetrics as Record<string, unknown>).p99_ms,
            ),
            avg_ms: asNullableNumber(
              (record.engineMetrics as Record<string, unknown>).avg_ms,
            ),
          }
        : {
            total_evals: 0,
            p50_ms: null,
            p95_ms: null,
            p99_ms: null,
            avg_ms: null,
          },
    connectorMetrics: Array.isArray(record.connectorMetrics)
      ? record.connectorMetrics.map((item) => {
          const metric =
            item && typeof item === "object"
              ? (item as Record<string, unknown>)
              : {};
          return {
            connector_key:
              typeof metric.connector_key === "string"
                ? metric.connector_key
                : "unknown",
            total_checks: asNumber(metric.total_checks),
            cache_hits: asNumber(metric.cache_hits),
            cache_misses: asNumber(metric.cache_misses),
            cache_hit_rate: asNumber(metric.cache_hit_rate),
            ok_count: asNumber(metric.ok_count),
            timeout_count: asNumber(metric.timeout_count),
            background_pending_count: asNumber(metric.background_pending_count),
            error_count: asNumber(metric.error_count),
            unavailable_count: asNumber(metric.unavailable_count),
            avg_response_ms: asNullableNumber(metric.avg_response_ms),
            p95_response_ms: asNullableNumber(metric.p95_response_ms),
            avg_cache_age_hours: asNullableNumber(metric.avg_cache_age_hours),
          };
        })
      : [],
    metadataCacheMetrics: Array.isArray(record.metadataCacheMetrics)
      ? record.metadataCacheMetrics.map((item) => {
          const metric =
            item && typeof item === "object"
              ? (item as Record<string, unknown>)
              : {};
          return {
            proxy_id:
              typeof metric.proxy_id === "string" ? metric.proxy_id : "",
            proxy_name:
              typeof metric.proxy_name === "string"
                ? metric.proxy_name
                : "Unknown proxy",
            ecosystem:
              typeof metric.ecosystem === "string"
                ? metric.ecosystem
                : "unknown",
            hits: asNumber(metric.hits),
            misses: asNumber(metric.misses),
            stale_hits: asNumber(metric.stale_hits),
            refreshes: asNumber(metric.refreshes),
            parse_failures: asNumber(metric.parse_failures),
            store_failures: asNumber(metric.store_failures),
            hit_rate: asNumber(metric.hit_rate),
          };
        })
      : [],
  };
}

export async function fetchPerformance(
  window: PerformanceWindow,
): Promise<PerformanceData> {
  const response = await apiFetch(`/v1/performance?window=${window}`);
  return normalizePerformanceData(response, window);
}
