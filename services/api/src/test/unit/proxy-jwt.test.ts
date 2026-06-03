import { beforeEach, describe, expect, it, vi } from "vitest";
import { TENANT_PROXY_SCOPE } from "@customs/shared-constants";

const {
  importJwkMock,
  signMock,
  jwtVerifyMock,
  setProtectedHeaderMock,
  setIssuedAtMock,
  setIssuerMock,
  setAudienceMock,
  setSubjectMock,
  setJtiMock,
  setExpirationTimeMock,
  signJwtPayloads,
} = vi.hoisted(() => {
  const importJwkMock = vi.fn();
  const setProtectedHeaderMock = vi.fn();
  const setIssuedAtMock = vi.fn();
  const setIssuerMock = vi.fn();
  const setAudienceMock = vi.fn();
  const setSubjectMock = vi.fn();
  const setJtiMock = vi.fn();
  const setExpirationTimeMock = vi.fn();
  const signMock = vi.fn();
  const jwtVerifyMock = vi.fn();
  const signJwtPayloads: unknown[] = [];
  return {
    importJwkMock,
    signMock,
    jwtVerifyMock,
    setProtectedHeaderMock,
    setIssuedAtMock,
    setIssuerMock,
    setAudienceMock,
    setSubjectMock,
    setJtiMock,
    setExpirationTimeMock,
    signJwtPayloads,
  };
});

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "jti-123"),
}));

vi.mock("jose", () => {
  class SignJWT {
    payload: unknown;

    constructor(payload: unknown) {
      this.payload = payload;
      signJwtPayloads.push(payload);
    }

    setProtectedHeader = setProtectedHeaderMock.mockReturnValue(this);
    setIssuedAt = setIssuedAtMock.mockReturnValue(this);
    setIssuer = setIssuerMock.mockReturnValue(this);
    setAudience = setAudienceMock.mockReturnValue(this);
    setSubject = setSubjectMock.mockReturnValue(this);
    setJti = setJtiMock.mockReturnValue(this);
    setExpirationTime = setExpirationTimeMock.mockReturnValue(this);
    sign = signMock.mockResolvedValue("signed-token");
  }

  return {
    importJWK: importJwkMock,
    SignJWT,
    jwtVerify: jwtVerifyMock,
  };
});

vi.mock("../../config.js", () => ({
  config: {
    proxyJwtTtlSeconds: 100,
    internalServiceJwtPrivateJwk: JSON.stringify({
      kty: "EC",
      crv: "P-256",
      x: "test-x",
      y: "test-y",
      d: "test-d",
      alg: "ES256",
    }),
    internalServiceJwtKeyId: "test-internal-service-1",
  },
}));

import {
  issueProxyRuntimeToken,
  verifyProxyRuntimeToken,
} from "../../auth/proxy-jwt.js";

describe("proxy JWT helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signJwtPayloads.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T16:00:00Z"));
    importJwkMock.mockResolvedValue({ type: "CryptoKey" });
  });

  it("issues a signed runtime token and computes refresh timing", async () => {
    const result = await issueProxyRuntimeToken({
      proxyId: "proxy-1",
      tenantId: "tenant-1",
    });

    expect(result).toEqual({
      accessToken: "signed-token",
      expiresAt: new Date("2026-04-18T16:01:40.000Z"),
      refreshAfter: new Date("2026-04-18T16:01:20.000Z"),
    });
    expect(setProtectedHeaderMock).toHaveBeenCalledWith({
      alg: "ES256",
      kid: "test-internal-service-1",
    });
    expect(setIssuerMock).toHaveBeenCalledWith("customs-control-plane");
    expect(setAudienceMock).toHaveBeenCalledWith("customs-proxy-rpc");
    expect(setSubjectMock).toHaveBeenCalledWith("proxy-1");
    expect(setJtiMock).toHaveBeenCalledWith("jti-123");
    expect(signMock).toHaveBeenCalledOnce();
    expect(setSubjectMock).toHaveBeenCalledWith("proxy-1");
    expect(signJwtPayloads[0]).toMatchObject({
      proxy_id: "proxy-1",
      tenant_scope: TENANT_PROXY_SCOPE.OWNER_ONLY,
    });
  });

  it("includes all-tenants scope when issuing shared proxy tokens", async () => {
    await issueProxyRuntimeToken({
      proxyId: "proxy-1",
      tenantId: "tenant-1",
      tenantScope: TENANT_PROXY_SCOPE.ALL_TENANTS,
    });

    expect(signJwtPayloads[0]).toMatchObject({
      proxy_id: "proxy-1",
      tenant_scope: TENANT_PROXY_SCOPE.ALL_TENANTS,
    });
  });

  it("verifies proxy runtime token claims", async () => {
    jwtVerifyMock.mockResolvedValueOnce({
      payload: {
        sub: "proxy-1",
        service: "proxy",
        proxy_id: "proxy-1",
        tenant_id: "tenant-1",
        jti: "jti-123",
        exp: 1776528160,
      },
    });

    await expect(verifyProxyRuntimeToken("token")).resolves.toEqual({
      proxyId: "proxy-1",
      tenantId: "tenant-1",
      tenantScope: TENANT_PROXY_SCOPE.OWNER_ONLY,
      jti: "jti-123",
      expiresAt: new Date("2026-04-18T16:02:40.000Z"),
    });
  });

  it("verifies shared proxy scope", async () => {
    jwtVerifyMock.mockResolvedValueOnce({
      payload: {
        sub: "proxy-1",
        service: "proxy",
        proxy_id: "proxy-1",
        tenant_id: "tenant-1",
        tenant_scope: TENANT_PROXY_SCOPE.ALL_TENANTS,
        jti: "jti-123",
        exp: 1776528160,
      },
    });

    await expect(verifyProxyRuntimeToken("token")).resolves.toMatchObject({
      tenantScope: TENANT_PROXY_SCOPE.ALL_TENANTS,
    });
  });

  it("rejects tokens with missing claims", async () => {
    jwtVerifyMock.mockResolvedValueOnce({
      payload: {
        sub: "proxy-1",
        service: "proxy",
        proxy_id: "proxy-1",
      },
    });

    await expect(verifyProxyRuntimeToken("token")).rejects.toThrow(
      "internal_service_jwt_missing_claims",
    );
  });

  it("rejects tokens for the wrong service", async () => {
    jwtVerifyMock.mockResolvedValueOnce({
      payload: {
        sub: "proxy-1",
        service: "api",
        proxy_id: "proxy-1",
        tenant_id: "tenant-1",
        jti: "jti-123",
        exp: 1776528160,
      },
    });

    await expect(verifyProxyRuntimeToken("token")).rejects.toThrow(
      "proxy_jwt_missing_claims",
    );
  });
});
