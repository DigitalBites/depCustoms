import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    environment: "test",
    databaseUrl: "postgresql://localhost/customs-unit-fake",
  },
}));

vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn(),
  },
}));
vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (_c: any, next: any) => {
    await next();
  }),
}));
vi.mock("../../http/guards.js", () => ({
  getAuthContext: () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    role: "owner",
  }),
  requireTenantCapability: vi.fn(() => true),
}));

import { Hono } from "hono";
import { db } from "../../db/index.js";
import { performanceRouter } from "../../routes/performance.js";
import { q } from "../helpers/fakes.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-18T00:00:00Z"));
});

describe("performance routes", () => {
  it("returns aggregated proxy, engine, connector, and metadata cache metrics", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(
        q([{ proxy_id: "proxy-1", name: "Primary Proxy" }]) as any,
      )
      .mockReturnValueOnce(
        q([
          {
            proxy_id: "proxy-1",
            tracked: 10,
            cache_hits: 6,
            cache_misses: 3,
            unavailable: 1,
            p50_ms: 12,
            p95_ms: 48,
            p99_ms: 60,
            avg_cache_ms: 4,
            avg_check_ms: 20,
          },
        ]) as any,
      )
      .mockReturnValueOnce(
        q([
          {
            total_evals: 8,
            p50_ms: 30,
            p95_ms: 90,
            p99_ms: 120,
            avg_ms: 40,
          },
        ]) as any,
      )
      .mockReturnValueOnce(
        q([
          {
            connector_key: "osv",
            total_checks: "5",
            cache_hits: "2",
            cache_misses: "3",
            ok_count: "3",
            timeout_count: "1",
            background_pending_count: "0",
            error_count: "0",
            unavailable_count: "1",
            avg_response_ms: "22",
            p95_response_ms: "40",
            avg_cache_age_hours: "1.4",
          },
        ]) as any,
      )
      .mockReturnValueOnce(
        q([
          {
            proxy_id: "proxy-1",
            ecosystem: "npm",
            hits: "10",
            misses: "3",
            stale_hits: "2",
            refreshes: "1",
            parse_failures: "0",
            store_failures: "0",
          },
        ]) as any,
      );

    const app = new Hono().route("/", performanceRouter);
    const res = await app.request("/v1/performance?window=24h");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      window: "24h",
      proxyMetrics: [
        {
          proxy_id: "proxy-1",
          proxy_name: "Primary Proxy",
          tracked: 10,
          cache_hits: 6,
          cache_misses: 3,
          unavailable: 1,
          cache_hit_rate: 60,
          p50_ms: 12,
          p95_ms: 48,
          p99_ms: 60,
          avg_cache_ms: 4,
          avg_check_ms: 20,
        },
      ],
      engineMetrics: {
        total_evals: 8,
        p50_ms: 30,
        p95_ms: 90,
        p99_ms: 120,
        avg_ms: 40,
      },
      connectorMetrics: [
        {
          connector_key: "osv",
          total_checks: 5,
          cache_hits: 2,
          cache_misses: 3,
          cache_hit_rate: 40,
          ok_count: 3,
          timeout_count: 1,
          background_pending_count: 0,
          error_count: 0,
          unavailable_count: 1,
          avg_response_ms: 22,
          p95_response_ms: 40,
          avg_cache_age_hours: 1.4,
        },
      ],
      metadataCacheMetrics: [
        {
          proxy_id: "proxy-1",
          proxy_name: "Primary Proxy",
          ecosystem: "npm",
          hits: 10,
          misses: 3,
          stale_hits: 2,
          refreshes: 1,
          parse_failures: 0,
          store_failures: 0,
          hit_rate: 67,
        },
      ],
    });
  });
});
