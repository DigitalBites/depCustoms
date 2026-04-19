/**
 * Unit tests for handleRecordUsage — all DB calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";

vi.mock("../../config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../config.js")>("../../config.js");
  return {
    ...actual,
    config: {
      ...actual.config,
      recordUsageMaxEvents: 2,
    },
  };
});

vi.mock("../../db/index.js");

import { db } from "../../db/index.js";
import {
  assertRecordUsageBatchWithinLimit,
  handleRecordUsage,
} from "../../connect/gateway.js";
import {
  q,
  fakeToken,
  TEST_PROXY_ID,
  TEST_TOKEN_HASH,
  TEST_TENANT_ID,
  TEST_PROJECT_ID,
} from "../helpers/fakes.js";
import type { VerifiedProxyContext } from "../../connect/proxy-context.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.insert).mockReturnValue(q(undefined) as any);
  vi.mocked(db.update).mockReturnValue(q(undefined) as any);
  vi.mocked(db.delete).mockReturnValue(q([]) as any);
});

function mockPackageUsageFlow(
  events: Array<{ ecosystem: string; package: string; version: string }>,
) {
  const uniquePackages = [
    ...new Map(
      events.map((event) => [
        `${event.ecosystem}|${event.package}`,
        {
          id: `pkg-${event.ecosystem}-${event.package}`,
          ecosystem: event.ecosystem,
          package: event.package,
        },
      ]),
    ).values(),
  ];

  const uniquePackageVersions = [
    ...new Map(
      events.map((event) => {
        const packageId = `pkg-${event.ecosystem}-${event.package}`;
        return [
          `${packageId}|${event.version}`,
          {
            id: `pkgver-${event.ecosystem}-${event.package}-${event.version}`,
            package_id: packageId,
            version: event.version,
          },
        ];
      }),
    ).values(),
  ];

  vi.mocked(db.insert)
    .mockReturnValueOnce(q(undefined) as any)
    .mockReturnValueOnce(q(uniquePackages) as any)
    .mockReturnValueOnce(q(uniquePackageVersions) as any)
    .mockReturnValueOnce(q(undefined) as any);
}

function fakeEvent(overrides: Record<string, unknown> = {}) {
  return {
    ecosystem: "npm",
    package: "lodash",
    version: "4.17.15",
    decision: 1, // ALLOW
    event_type: "artifact",
    decision_cache: true,
    requested_at: "2026-01-01T00:00:00Z",
    project_token_hash: TEST_TOKEN_HASH,
    trace_id: "trace-1",
    request_id: "req-1",
    tenant_id: TEST_TENANT_ID,
    project_id: TEST_PROJECT_ID,
    serve_mode: "SERVE_MODE_REDIRECT",
    bytes_transferred: 0,
    client_ip: "1.2.3.4",
    duration_ms: 2,
    decision_path: "cache_hit",
    ...overrides,
  };
}

function makeProxy(
  overrides: Partial<VerifiedProxyContext> = {},
): VerifiedProxyContext {
  return {
    proxyId: TEST_PROXY_ID,
    tenantId: TEST_TENANT_ID,
    proxyIp: "10.0.0.1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Empty batch
// ---------------------------------------------------------------------------

describe("empty batch", () => {
  it("returns 0 without calling DB for token resolution or insert", async () => {
    const result = await handleRecordUsage(makeProxy(), []);
    expect(result.recorded).toBe(0);
    // insert should never be called for empty batch
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Normal recording
// ---------------------------------------------------------------------------

describe("recording events", () => {
  it("resolves token and inserts events", async () => {
    mockPackageUsageFlow([fakeEvent()]);

    vi.mocked(db.select).mockReturnValueOnce(
      // token resolution
      q([
        {
          id: fakeToken().id,
          token_hash: TEST_TOKEN_HASH,
          tenant_id: TEST_TENANT_ID,
          project_id: TEST_PROJECT_ID,
        },
      ]) as any,
    );

    const result = await handleRecordUsage(makeProxy(), [fakeEvent()]);
    expect(result.recorded).toBe(1);
    expect(vi.mocked(db.insert)).toHaveBeenCalled();

    const insertBuilder = vi.mocked(db.insert).mock.results[0]?.value;
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          proxy_id: TEST_PROXY_ID,
        }),
      ]),
    );
  });

  it("records correct count for multiple events", async () => {
    const usageEvents = [
      fakeEvent(),
      fakeEvent({ package: "express", version: "5.0.0" }),
    ];
    mockPackageUsageFlow(usageEvents);

    vi.mocked(db.select).mockReturnValueOnce(
      q([
        {
          id: fakeToken().id,
          token_hash: TEST_TOKEN_HASH,
          tenant_id: TEST_TENANT_ID,
          project_id: TEST_PROJECT_ID,
        },
      ]) as any,
    );

    const result = await handleRecordUsage(makeProxy(), usageEvents);
    expect(result.recorded).toBe(2);

    const insertBuilder = vi.mocked(db.insert).mock.results[0]?.value;
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ proxy_id: TEST_PROXY_ID, package: "lodash" }),
        expect.objectContaining({
          proxy_id: TEST_PROXY_ID,
          package: "express",
        }),
      ]),
    );
  });

  it("skips events where tenant_id cannot be resolved", async () => {
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any); // token not found

    // Event has no tenant_id in the WAL entry either
    const result = await handleRecordUsage(makeProxy(), [
      fakeEvent({ project_token_hash: "unknown-hash", tenant_id: "" }),
    ]);
    expect(result.recorded).toBe(0);
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it("falls back to WAL-supplied tenant_id when DB lookup fails", async () => {
    const usageEvents = [fakeEvent({ tenant_id: TEST_TENANT_ID })];
    mockPackageUsageFlow(usageEvents);

    vi.mocked(db.select).mockReturnValueOnce(q([]) as any); // token not in DB (already deleted)

    // WAL has tenant_id from a prior successful check
    const result = await handleRecordUsage(makeProxy(), usageEvents);
    expect(result.recorded).toBe(1);
  });

  it("deduplicates token hashing — only one batch select for multiple events with same token", async () => {
    const usageEvents = [
      fakeEvent(),
      fakeEvent({ package: "react" }),
      fakeEvent({ package: "vue" }),
    ];
    mockPackageUsageFlow(usageEvents);

    vi.mocked(db.select).mockReturnValueOnce(
      q([
        {
          id: fakeToken().id,
          token_hash: TEST_TOKEN_HASH,
          tenant_id: TEST_TENANT_ID,
          project_id: TEST_PROJECT_ID,
        },
      ]) as any,
    );

    // Three events, all same token
    await handleRecordUsage(makeProxy(), usageEvents);

    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(1);
  });

  it("rejects batches above the configured server-side maximum", () => {
    expect(() => assertRecordUsageBatchWithinLimit(2)).not.toThrow();
    expect(() => assertRecordUsageBatchWithinLimit(3)).toThrow(
      "recordUsage batch exceeds max size of 2 events",
    );
  });
});
