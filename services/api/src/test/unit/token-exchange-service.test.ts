import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    environment: "test",
    databaseUrl: "postgresql://localhost/customs-unit-fake",
    proxyJwtSecret: "proxy-secret",
    proxyJwtTtlSeconds: 100,
  },
}));

vi.mock("../../features/internal-proxy-auth/bootstrap-auth-service.js", () => ({
  authenticateBootstrapProxy: vi.fn(),
}));

vi.mock("../../auth/proxy-jwt.js", () => ({
  issueProxyRuntimeToken: vi.fn(),
}));

vi.mock("../../features/proxies/status-events.js", () => ({
  insertProxyStatusEvent: vi.fn(),
}));

vi.mock("../../db/index.js", () => ({
  db: {
    update: vi.fn(),
  },
}));

import { authenticateBootstrapProxy } from "../../features/internal-proxy-auth/bootstrap-auth-service.js";
import { issueProxyRuntimeToken } from "../../auth/proxy-jwt.js";
import { insertProxyStatusEvent } from "../../features/proxies/status-events.js";
import { db } from "../../db/index.js";
import { exchangeProxyRuntimeToken } from "../../features/internal-proxy-auth/token-exchange-service.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.update).mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        catch: vi.fn(),
      }),
    }),
  } as any);
});

describe("exchangeProxyRuntimeToken", () => {
  it("audits disabled proxies and returns the auth failure", async () => {
    vi.mocked(authenticateBootstrapProxy).mockResolvedValueOnce({
      ok: false,
      status: 403,
      code: "PROXY_DISABLED",
      message: "Proxy is disabled",
      detail: null,
      auditProxy: { tenantId: "tenant-1", proxyId: "proxy-1" },
      auditDetail: "proxy_disabled",
    } as any);

    await expect(
      exchangeProxyRuntimeToken({
        proxyId: "proxy-1",
        proxySecret: "secret",
        proxyIp: "127.0.0.1",
      }),
    ).resolves.toEqual({
      ok: false,
      status: 403,
      code: "PROXY_DISABLED",
      message: "Proxy is disabled",
      detail: null,
    });

    expect(insertProxyStatusEvent).toHaveBeenNthCalledWith(1, {
      tenantId: "tenant-1",
      proxyId: "proxy-1",
      proxyIp: "127.0.0.1",
      eventType: "token_exchange_attempt",
    });
    expect(insertProxyStatusEvent).toHaveBeenNthCalledWith(2, {
      tenantId: "tenant-1",
      proxyId: "proxy-1",
      proxyIp: "127.0.0.1",
      eventType: "token_exchange_failed",
      detail: "proxy_disabled",
    });
  });

  it("issues a runtime token and records success events", async () => {
    vi.mocked(authenticateBootstrapProxy).mockResolvedValueOnce({
      ok: true,
      proxy: {
        id: "row-1",
        tenant_id: "tenant-1",
        proxy_id: "proxy-1",
      },
    } as any);
    vi.mocked(issueProxyRuntimeToken).mockResolvedValueOnce({
      accessToken: "jwt",
      expiresAt: new Date("2026-04-18T16:02:00Z"),
      refreshAfter: new Date("2026-04-18T16:01:30Z"),
    });

    await expect(
      exchangeProxyRuntimeToken({
        proxyId: "proxy-1",
        proxySecret: "secret",
        proxyIp: null,
      }),
    ).resolves.toEqual({
      ok: true,
      accessToken: "jwt",
      expiresAt: new Date("2026-04-18T16:02:00Z"),
      refreshAfter: new Date("2026-04-18T16:01:30Z"),
    });

    expect(issueProxyRuntimeToken).toHaveBeenCalledWith({
      proxyId: "proxy-1",
      tenantId: "tenant-1",
    });
    expect(insertProxyStatusEvent).toHaveBeenNthCalledWith(1, {
      tenantId: "tenant-1",
      proxyId: "proxy-1",
      proxyIp: null,
      eventType: "token_exchange_attempt",
    });
    expect(insertProxyStatusEvent).toHaveBeenNthCalledWith(2, {
      tenantId: "tenant-1",
      proxyId: "proxy-1",
      proxyIp: null,
      eventType: "token_issued",
    });
  });
});
