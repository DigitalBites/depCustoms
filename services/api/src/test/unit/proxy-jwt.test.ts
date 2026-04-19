import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  signMock,
  jwtVerifyMock,
  setProtectedHeaderMock,
  setIssuedAtMock,
  setIssuerMock,
  setAudienceMock,
  setSubjectMock,
  setJtiMock,
  setExpirationTimeMock,
} = vi.hoisted(() => {
  const setProtectedHeaderMock = vi.fn();
  const setIssuedAtMock = vi.fn();
  const setIssuerMock = vi.fn();
  const setAudienceMock = vi.fn();
  const setSubjectMock = vi.fn();
  const setJtiMock = vi.fn();
  const setExpirationTimeMock = vi.fn();
  const signMock = vi.fn();
  const jwtVerifyMock = vi.fn();
  return {
    signMock,
    jwtVerifyMock,
    setProtectedHeaderMock,
    setIssuedAtMock,
    setIssuerMock,
    setAudienceMock,
    setSubjectMock,
    setJtiMock,
    setExpirationTimeMock,
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
    SignJWT,
    jwtVerify: jwtVerifyMock,
  };
});

vi.mock("../../config.js", () => ({
  config: {
    proxyJwtSecret: "proxy-secret",
    proxyJwtTtlSeconds: 100,
  },
}));

import {
  issueProxyRuntimeToken,
  verifyProxyRuntimeToken,
} from "../../auth/proxy-jwt.js";

describe("proxy JWT helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T16:00:00Z"));
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
    expect(setProtectedHeaderMock).toHaveBeenCalledWith({ alg: "HS256" });
    expect(setIssuerMock).toHaveBeenCalledWith("customs-control-plane");
    expect(setAudienceMock).toHaveBeenCalledWith("customs-proxy-rpc");
    expect(setSubjectMock).toHaveBeenCalledWith("proxy-1");
    expect(setJtiMock).toHaveBeenCalledWith("jti-123");
    expect(signMock).toHaveBeenCalledOnce();
  });

  it("verifies proxy runtime token claims", async () => {
    jwtVerifyMock.mockResolvedValueOnce({
      payload: {
        sub: "proxy-1",
        proxy_id: "proxy-1",
        tenant_id: "tenant-1",
        jti: "jti-123",
        exp: 1776528160,
      },
    });

    await expect(verifyProxyRuntimeToken("token")).resolves.toEqual({
      proxyId: "proxy-1",
      tenantId: "tenant-1",
      jti: "jti-123",
      expiresAt: new Date("2026-04-18T16:02:40.000Z"),
    });
  });

  it("rejects tokens with missing claims", async () => {
    jwtVerifyMock.mockResolvedValueOnce({
      payload: {
        sub: "proxy-1",
        proxy_id: "proxy-1",
      },
    });

    await expect(verifyProxyRuntimeToken("token")).rejects.toThrow(
      "proxy_jwt_missing_claims",
    );
  });
});
