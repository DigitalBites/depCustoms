export type PerformanceWindow = "1h" | "24h" | "7d";

export interface ProxyMetric {
  proxy_id: string;
  proxy_name: string;
  tracked: number;
  cache_hits: number;
  cache_misses: number;
  unavailable: number;
  cache_hit_rate: number;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  avg_cache_ms: number | null;
  avg_check_ms: number | null;
}

export interface EngineMetrics {
  total_evals: number;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  avg_ms: number | null;
}

export interface ConnectorMetric {
  connector_key: string;
  total_checks: number;
  cache_hits: number;
  cache_misses: number;
  cache_hit_rate: number;
  ok_count: number;
  timeout_count: number;
  background_pending_count: number;
  error_count: number;
  unavailable_count: number;
  avg_response_ms: number | null;
  p95_response_ms: number | null;
  avg_cache_age_hours: number | null;
}

export interface MetadataCacheMetric {
  proxy_id: string;
  proxy_name: string;
  ecosystem: string;
  hits: number;
  misses: number;
  stale_hits: number;
  refreshes: number;
  parse_failures: number;
  store_failures: number;
  hit_rate: number;
}

export interface PerformanceData {
  window: PerformanceWindow;
  proxyMetrics: ProxyMetric[];
  engineMetrics: EngineMetrics;
  connectorMetrics: ConnectorMetric[];
  metadataCacheMetrics: MetadataCacheMetric[];
}
