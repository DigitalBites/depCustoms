import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";

vi.mock("../../config.js", () => ({
  config: {
    environment: "test",
    databaseUrl: "postgresql://localhost/customs-unit-fake",
  },
}));

vi.mock("../../connect/proxy-auth.js", () => ({
  requireBootstrapAuthenticatedProxy: vi.fn(),
}));

vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn(),
  },
}));

import { requireBootstrapAuthenticatedProxy } from "../../connect/proxy-auth.js";
import { db } from "../../db/index.js";
import { authenticateBootstrapProxy } from "../../features/internal-proxy-auth/bootstrap-auth-service.js";
import { q } from "../helpers/fakes.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.select).mockReturnValue(q([]) as any);
});

describe("authenticateBootstrapProxy", () => {
  it("returns success for an active proxy", async () => {
    vi.mocked(requireBootstrapAuthenticatedProxy).mockResolvedValueOnce({
      id: "row-1",
      tenant_id: "tenant-1",
      proxy_id: "proxy-1",
      status: "active",
    } as any);

    await expect(
      authenticateBootstrapProxy({
        proxyId: "proxy-1",
        proxySecret: "secret",
        proxyIp: null,
      }),
    ).resolves.toEqual({
      ok: true,
      proxy: expect.objectContaining({ proxy_id: "proxy-1" }),
    });
  });

  it("returns disabled and revoked proxy failures with audit info", async () => {
    vi.mocked(requireBootstrapAuthenticatedProxy)
      .mockResolvedValueOnce({
        tenant_id: "tenant-1",
        proxy_id: "proxy-1",
        status: "disabled",
      } as any)
      .mockResolvedValueOnce({
        tenant_id: "tenant-2",
        proxy_id: "proxy-2",
        status: "revoked",
      } as any);

    await expect(
      authenticateBootstrapProxy({
        proxyId: "proxy-1",
        proxySecret: "secret",
        proxyIp: null,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "PROXY_DISABLED",
      auditProxy: { tenantId: "tenant-1", proxyId: "proxy-1" },
    });

    await expect(
      authenticateBootstrapProxy({
        proxyId: "proxy-2",
        proxySecret: "secret",
        proxyIp: null,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "PROXY_REVOKED",
      auditProxy: { tenantId: "tenant-2", proxyId: "proxy-2" },
    });
  });

  it("classifies invalid secrets and loads audit proxy rows", async () => {
    vi.mocked(requireBootstrapAuthenticatedProxy).mockRejectedValueOnce(
      new ConnectError("invalid_proxy_secret", Code.Unauthenticated),
    );
    vi.mocked(db.select).mockReturnValueOnce(
      q([{ tenant_id: "tenant-1", proxy_id: "proxy-1" }]) as any,
    );

    await expect(
      authenticateBootstrapProxy({
        proxyId: "proxy-1",
        proxySecret: "bad",
        proxyIp: "127.0.0.1",
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "INVALID_PROXY_SECRET",
      message: "Proxy secret is incorrect",
      auditProxy: { tenantId: "tenant-1", proxyId: "proxy-1" },
    });
  });

  it("classifies unregistered proxies without audit rows", async () => {
    vi.mocked(requireBootstrapAuthenticatedProxy).mockRejectedValueOnce(
      new Error("missing"),
    );

    await expect(
      authenticateBootstrapProxy({
        proxyId: undefined,
        proxySecret: "bad",
        proxyIp: null,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "UNREGISTERED_PROXY",
      auditProxy: null,
      auditDetail: "Error: missing",
    });
  });
});
