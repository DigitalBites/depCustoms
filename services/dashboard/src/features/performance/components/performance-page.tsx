"use client";

import { useState } from "react";
import { InlineError } from "@/components/feedback/inline-error";
import { PageLoading } from "@/components/feedback/page-loading";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/stat-card";
import { usePerformance } from "@/features/performance/hooks";
import type {
  ConnectorMetric,
  EngineMetrics,
  MetadataCacheMetric,
  PerformanceWindow,
  ProxyMetric,
} from "@/features/performance/types";

function ms(val: number | null): string {
  return val === null ? "—" : `${val} ms`;
}

function pct(val: number): string {
  return `${val}%`;
}

function hours(val: number | null): string {
  return val === null ? "—" : `${val} h`;
}

const WINDOWS: { value: PerformanceWindow; label: string }[] = [
  { value: "1h", label: "Last 1h" },
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7d" },
];

export function PerformancePage() {
  const [window, setWindow] = useState<PerformanceWindow>("1h");
  const { data, loading, error } = usePerformance(window);

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Performance"
        description="Proxy request latency and policy engine evaluation times."
        actions={
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
            {WINDOWS.map(({ value, label }) => (
              <button
                type="button"
                key={value}
                onClick={() => setWindow(value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  window === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      <InlineError message={error} className="mb-6" />

      {loading ? (
        <PageLoading />
      ) : data ? (
        <div className="space-y-8">
          <EngineSection metrics={data.engineMetrics} />
          <ConnectorSection connectors={data.connectorMetrics} />
          <MetadataCacheSection metrics={data.metadataCacheMetrics} />
          <ProxySection proxies={data.proxyMetrics} />
        </div>
      ) : null}
    </div>
  );
}

function EngineSection({ metrics }: { metrics: EngineMetrics }) {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-foreground">
        Rules Engine
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Time spent evaluating policies and connector data per Check request.
        Excludes proxy-side overhead.
      </p>
      {metrics.total_evals === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          No policy evaluations in this window.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <StatCard label="Evaluations" value={String(metrics.total_evals)} />
          <StatCard label="Avg eval time" value={ms(metrics.avg_ms)} />
          <StatCard label="p50 eval time" value={ms(metrics.p50_ms)} />
          <StatCard
            label="p95 eval time"
            value={ms(metrics.p95_ms)}
            accent={
              metrics.p95_ms !== null && metrics.p95_ms > 500
                ? "orange"
                : undefined
            }
          />
          <StatCard
            label="p99 eval time"
            value={ms(metrics.p99_ms)}
            accent={
              metrics.p99_ms !== null && metrics.p99_ms > 1000
                ? "red"
                : undefined
            }
          />
        </div>
      )}
    </section>
  );
}

function ConnectorSection({ connectors }: { connectors: ConnectorMetric[] }) {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-foreground">
        Connectors
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Connector cache behaviour and live fetch timing recorded during policy
        evaluation.
      </p>
      {connectors.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          No connector evaluations in this window.
        </p>
      ) : (
        <div className="space-y-6">
          {connectors.map((connector) => (
            <ConnectorBlock
              key={connector.connector_key}
              connector={connector}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ConnectorBlock({ connector }: { connector: ConnectorMetric }) {
  const hitRateAccent =
    connector.cache_hit_rate >= 80
      ? "green"
      : connector.cache_hit_rate >= 50
        ? "orange"
        : connector.total_checks > 0
          ? "red"
          : undefined;
  const timeoutAccent =
    connector.timeout_count +
      connector.error_count +
      connector.unavailable_count >
    0
      ? "orange"
      : undefined;

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="font-medium uppercase text-foreground">
          {connector.connector_key}
        </span>
      </div>

      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Cache behaviour
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Checks" value={String(connector.total_checks)} />
            <StatCard
              label="Cache hit rate"
              value={pct(connector.cache_hit_rate)}
              sub={`${connector.cache_hits} hits / ${connector.cache_misses} misses`}
              accent={hitRateAccent}
            />
            <StatCard label="Cache hits" value={String(connector.cache_hits)} />
            <StatCard
              label="Avg cache age"
              value={hours(connector.avg_cache_age_hours)}
              sub="on cache hits"
            />
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Fetch latency
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Avg fetch" value={ms(connector.avg_response_ms)} />
            <StatCard
              label="p95 fetch"
              value={ms(connector.p95_response_ms)}
              accent={
                connector.p95_response_ms !== null &&
                connector.p95_response_ms > 1000
                  ? "orange"
                  : undefined
              }
            />
            <StatCard
              label="Background pending"
              value={String(connector.background_pending_count)}
              sub="timed out at request deadline"
              accent={
                connector.background_pending_count > 0 ? "orange" : undefined
              }
            />
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Status
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard label="OK" value={String(connector.ok_count)} />
            <StatCard
              label="Timeouts"
              value={String(connector.timeout_count)}
              accent={connector.timeout_count > 0 ? "orange" : undefined}
            />
            <StatCard
              label="Errors"
              value={String(connector.error_count)}
              accent={connector.error_count > 0 ? "red" : undefined}
            />
            <StatCard
              label="Unavailable"
              value={String(connector.unavailable_count)}
              accent={timeoutAccent}
            />
            <StatCard
              label="Cache misses"
              value={String(connector.cache_misses)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ProxySection({ proxies }: { proxies: ProxyMetric[] }) {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-foreground">
        Proxy Performance
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        End-to-end request latency measured at each proxy — from first byte
        received to response sent.
      </p>
      {proxies.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          No proxy events with timing data in this window.
        </p>
      ) : (
        <div className="space-y-6">
          {proxies.map((proxy) => (
            <ProxyBlock key={proxy.proxy_id} proxy={proxy} />
          ))}
        </div>
      )}
    </section>
  );
}

function MetadataCacheSection({ metrics }: { metrics: MetadataCacheMetric[] }) {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-foreground">
        Metadata Cache
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Proxy-local package metadata cache behaviour aggregated by proxy and
        ecosystem.
      </p>
      {metrics.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          No metadata-cache telemetry in this window.
        </p>
      ) : (
        <div className="space-y-6">
          {metrics.map((metric) => (
            <MetadataCacheBlock
              key={`${metric.proxy_id}:${metric.ecosystem}`}
              metric={metric}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MetadataCacheBlock({ metric }: { metric: MetadataCacheMetric }) {
  const hitRateAccent =
    metric.hit_rate >= 80
      ? "green"
      : metric.hit_rate >= 50
        ? "orange"
        : metric.hits + metric.misses + metric.stale_hits > 0
          ? "red"
          : undefined;

  const failureAccent =
    metric.parse_failures + metric.store_failures > 0 ? "orange" : undefined;

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="font-medium text-foreground">{metric.proxy_name}</span>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs uppercase text-muted-foreground">
          {metric.ecosystem}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {metric.proxy_id}
        </span>
      </div>

      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Lookup behaviour
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard
              label="Hit rate"
              value={pct(metric.hit_rate)}
              accent={hitRateAccent}
            />
            <StatCard label="Hits" value={String(metric.hits)} />
            <StatCard label="Misses" value={String(metric.misses)} />
            <StatCard label="Stale hits" value={String(metric.stale_hits)} />
            <StatCard label="Refreshes" value={String(metric.refreshes)} />
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Failures
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
            <StatCard
              label="Parse failures"
              value={String(metric.parse_failures)}
              accent={metric.parse_failures > 0 ? "orange" : undefined}
            />
            <StatCard
              label="Store failures"
              value={String(metric.store_failures)}
              accent={failureAccent}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ProxyBlock({ proxy: p }: { proxy: ProxyMetric }) {
  const hitRateAccent =
    p.cache_hit_rate >= 80
      ? "green"
      : p.cache_hit_rate >= 50
        ? "orange"
        : p.tracked > 0
          ? "red"
          : undefined;

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="font-medium text-foreground">{p.proxy_name}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {p.proxy_id}
        </span>
      </div>

      {p.tracked === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          No latency data in this window.
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Cache behaviour
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Tracked requests" value={String(p.tracked)} />
              <StatCard
                label="Cache hit rate"
                value={pct(p.cache_hit_rate)}
                sub={`${p.cache_hits} hits / ${p.cache_misses} misses`}
                accent={hitRateAccent}
              />
              <StatCard label="Cache hits" value={String(p.cache_hits)} />
              <StatCard
                label="CP unavailable"
                value={String(p.unavailable)}
                accent={p.unavailable > 0 ? "orange" : undefined}
                sub="fail-closed blocks"
              />
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Latency (all decisions)
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard label="p50" value={ms(p.p50_ms)} />
              <StatCard
                label="p95"
                value={ms(p.p95_ms)}
                accent={
                  p.p95_ms !== null && p.p95_ms > 200 ? "orange" : undefined
                }
              />
              <StatCard
                label="p99"
                value={ms(p.p99_ms)}
                accent={p.p99_ms !== null && p.p99_ms > 500 ? "red" : undefined}
              />
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Avg latency by decision path
            </p>
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Avg (cache hit)"
                value={ms(p.avg_cache_ms)}
                sub="served from proxy cache"
              />
              <StatCard
                label="Avg (cache miss)"
                value={ms(p.avg_check_ms)}
                sub="required control plane check"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
