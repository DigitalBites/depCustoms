import { beforeEach, describe, expect, it, vi } from "vitest";
import { Code } from "@connectrpc/connect";

vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("../../auth/proxy-jwt.js", () => ({
  verifyProxyRuntimeToken: vi.fn(),
}));

vi.mock("../../logger.js", () => ({
  log: {
    warn: vi.fn(),
  },
}));

import { db } from "../../db/index.js";
import { verifyProxyRuntimeToken } from "../../auth/proxy-jwt.js";
import {
  proxyJwtAuthInterceptor,
  requireBootstrapAuthenticatedProxy,
} from "../../connect/proxy-auth.js";
import {
  TEST_PROXY_ID,
  TEST_PROXY_SECRET,
  TEST_PROXY_SECRET_HASH,
  TEST_TENANT_ID,
  fakeProxy,
  q,
} from "../helpers/fakes.js";
import { verifiedProxyContextKey } from "../../connect/proxy-context.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.select).mockReset();
  vi.mocked(verifyProxyRuntimeToken).mockReset();
});

describe("requireBootstrapAuthenticatedProxy", () => {
  it("rejects missing bootstrap credentials", async () => {
    await expect(
      requireBootstrapAuthenticatedProxy({
        proxySecret: undefined,
        proxyId: TEST_PROXY_ID,
        proxyIp: "127.0.0.1",
      }),
    ).rejects.toMatchObject({
      code: Code.Unauthenticated,
      rawMessage: "unregistered_proxy",
    });
  });

  it("rejects unregistered proxies", async () => {
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any);

    await expect(
      requireBootstrapAuthenticatedProxy({
        proxySecret: TEST_PROXY_SECRET,
        proxyId: TEST_PROXY_ID,
        proxyIp: "127.0.0.1",
      }),
    ).rejects.toMatchObject({
      code: Code.Unauthenticated,
      rawMessage: "unregistered_proxy",
    });
  });

  it("accepts the previous secret while it is still valid", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        fakeProxy({
          proxy_id: TEST_PROXY_ID,
          secret_hash: "different-hash",
          secret_prev_hash: TEST_PROXY_SECRET_HASH,
          secret_prev_expires_at: new Date("2099-01-01T00:00:00Z"),
        }),
      ]) as any,
    );

    const row = await requireBootstrapAuthenticatedProxy({
      proxySecret: TEST_PROXY_SECRET,
      proxyId: TEST_PROXY_ID,
      proxyIp: "127.0.0.1",
    });

    expect(row.proxy_id).toBe(TEST_PROXY_ID);
    expect(row.tenant_id).toBe(TEST_TENANT_ID);
  });

  it("rejects invalid secrets", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([fakeProxy({ proxy_id: TEST_PROXY_ID })]) as any,
    );

    await expect(
      requireBootstrapAuthenticatedProxy({
        proxySecret: "cxp_wrong_secret",
        proxyId: TEST_PROXY_ID,
        proxyIp: "127.0.0.1",
      }),
    ).rejects.toMatchObject({
      code: Code.Unauthenticated,
      rawMessage: "invalid_proxy_secret",
    });
  });
});

describe("proxyJwtAuthInterceptor", () => {
  it("rejects missing bearer tokens", async () => {
    const interceptor = proxyJwtAuthInterceptor();
    const next = vi.fn();
    const handler = interceptor(next as any);

    await expect(
      handler({
        header: new Headers(),
        contextValues: new Map(),
      } as any),
    ).rejects.toMatchObject({
      code: Code.Unauthenticated,
      rawMessage: "invalid_proxy_token",
    });
  });

  it("rejects invalid runtime tokens", async () => {
    vi.mocked(verifyProxyRuntimeToken).mockRejectedValueOnce(
      new Error("bad token"),
    );
    const interceptor = proxyJwtAuthInterceptor();
    const next = vi.fn();
    const handler = interceptor(next as any);

    await expect(
      handler({
        header: new Headers({
          authorization: "Bearer bad-token",
          "x-proxy-remote-addr": "10.0.0.2",
        }),
        contextValues: new Map(),
      } as any),
    ).rejects.toMatchObject({
      code: Code.Unauthenticated,
      rawMessage: "invalid_proxy_token",
    });
  });

  it("stores verified proxy claims in the request context", async () => {
    vi.mocked(verifyProxyRuntimeToken).mockResolvedValueOnce({
      proxyId: TEST_PROXY_ID,
      tenantId: TEST_TENANT_ID,
    } as any);
    const interceptor = proxyJwtAuthInterceptor();
    const next = vi.fn(async (req: any) => {
      expect(req.contextValues.get(verifiedProxyContextKey)).toEqual({
        proxyId: TEST_PROXY_ID,
        tenantId: TEST_TENANT_ID,
        proxyIp: "10.0.0.2",
      });
      return "ok";
    });
    const handler = interceptor(next as any);

    const result = await handler({
      header: new Headers({
        authorization: `Bearer runtime-token`,
        "x-proxy-remote-addr": "10.0.0.2",
      }),
      contextValues: new Map(),
    } as any);

    expect(result).toBe("ok");
    expect(next).toHaveBeenCalledOnce();
  });
});
