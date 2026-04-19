import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../../db/index.js");

import { db } from "../../db/index.js";
import { handleRecordProxyStatus } from "../../connect/gateway.js";
import { q, TEST_PROXY_ID, TEST_TENANT_ID } from "../helpers/fakes.js";
import type { VerifiedProxyContext } from "../../connect/proxy-context.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.insert).mockReturnValue(q(undefined) as any);
});

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

describe("handleRecordProxyStatus", () => {
  it("records proxy status events for authenticated proxies", async () => {
    await expect(
      handleRecordProxyStatus(makeProxy(), "proxy_online"),
    ).resolves.toBeUndefined();

    const insertBuilder = vi.mocked(db.insert).mock.results[0]?.value;
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TEST_TENANT_ID,
        proxy_id: TEST_PROXY_ID,
        proxy_ip: "10.0.0.1",
        event_type: "proxy_online",
      }),
    );
  });
});
