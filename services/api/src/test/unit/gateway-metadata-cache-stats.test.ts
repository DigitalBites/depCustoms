import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/index.js");

import { db } from "../../db/index.js";
import { handleRecordMetadataCacheStats } from "../../connect/gateway.js";
import { q, TEST_PROXY_ID, TEST_TENANT_ID } from "../helpers/fakes.js";
import type { VerifiedProxyContext } from "../../connect/proxy-context.js";

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.insert).mockReturnValue(q(undefined) as any);
});

describe("handleRecordMetadataCacheStats", () => {
  it("inserts one aggregate stats window", async () => {
    await handleRecordMetadataCacheStats(makeProxy(), {
      ecosystem: "npm",
      hits: 12,
      misses: 3,
      stale_hits: 1,
      refreshes: 6,
      parse_failures: 2,
      store_failures: 0,
      window_started_at: "2026-04-08T22:00:00Z",
      window_ended_at: "2026-04-08T22:05:00Z",
    });

    expect(vi.mocked(db.insert)).toHaveBeenCalledTimes(1);
    const insertBuilder = vi.mocked(db.insert).mock.results[0]?.value;
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TEST_TENANT_ID,
        proxy_id: TEST_PROXY_ID,
        ecosystem: "npm",
        hits: 12,
        misses: 3,
        stale_hits: 1,
        refreshes: 6,
        parse_failures: 2,
        store_failures: 0,
        window_started_at: new Date("2026-04-08T22:00:00Z"),
        window_ended_at: new Date("2026-04-08T22:05:00Z"),
      }),
    );
  });
});
