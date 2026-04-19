import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createRemoteJWKSetMock,
  jwtVerifyMock,
  JOSEError,
  JWTExpired,
  JWKSNoMatchingKey,
  JWSSignatureVerificationFailed,
  JWTClaimValidationFailed,
  JWSInvalid,
  JWTInvalid,
} = vi.hoisted(() => {
  class HOISTED_JOSEError extends Error {}
  class HOISTED_JWKSNoMatchingKey extends Error {}
  class HOISTED_JWSSignatureVerificationFailed extends Error {}
  class HOISTED_JWTClaimValidationFailed extends Error {}
  class HOISTED_JWSInvalid extends Error {}
  class HOISTED_JWTInvalid extends Error {}
  class HOISTED_JWTExpired extends HOISTED_JWTClaimValidationFailed {}

  return {
    createRemoteJWKSetMock: vi.fn(() => "jwks-set"),
    jwtVerifyMock: vi.fn(),
    JOSEError: HOISTED_JOSEError,
    JWTExpired: HOISTED_JWTExpired,
    JWKSNoMatchingKey: HOISTED_JWKSNoMatchingKey,
    JWSSignatureVerificationFailed: HOISTED_JWSSignatureVerificationFailed,
    JWTClaimValidationFailed: HOISTED_JWTClaimValidationFailed,
    JWSInvalid: HOISTED_JWSInvalid,
    JWTInvalid: HOISTED_JWTInvalid,
  };
});

vi.mock("jose", () => ({
  createRemoteJWKSet: createRemoteJWKSetMock,
  jwtVerify: jwtVerifyMock,
  errors: {
    JOSEError,
    JWTExpired,
    JWKSNoMatchingKey,
    JWSSignatureVerificationFailed,
    JWTClaimValidationFailed,
    JWSInvalid,
    JWTInvalid,
  },
}));

vi.mock("../../config.js", () => ({
  config: {
    authUrl: "https://auth.example.com",
    gotrueUrl: "",
  },
}));

import { config } from "../../config.js";

async function loadVerifierModule() {
  return await import("../../auth/jwt-verifier.js");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  (config as any).authUrl = "https://auth.example.com";
  (config as any).gotrueUrl = "";
});

describe("verifyAccessToken", () => {
  it("verifies access tokens against authUrl-derived JWKS", async () => {
    const { verifyAccessToken } = await loadVerifierModule();
    jwtVerifyMock.mockResolvedValueOnce({
      payload: {
        sub: "00000000-0000-0000-0000-000000000099",
        aud: "dashboard",
      },
    });

    const payload = await verifyAccessToken("token", "dashboard");
    expect(payload.sub).toBe("00000000-0000-0000-0000-000000000099");
    expect(createRemoteJWKSetMock).toHaveBeenCalledOnce();
    expect(jwtVerifyMock).toHaveBeenCalledWith("token", "jwks-set", {
      audience: "dashboard",
    });
  });

  it("prefers gotrueUrl when configured", async () => {
    const { verifyAccessToken } = await loadVerifierModule();
    (config as any).gotrueUrl = "https://gotrue.example.com/";
    jwtVerifyMock.mockResolvedValueOnce({
      payload: { sub: "00000000-0000-0000-0000-000000000099" },
    });

    await verifyAccessToken("token", "dashboard");
    expect(createRemoteJWKSetMock).toHaveBeenCalledWith(
      new URL("https://gotrue.example.com/.well-known/jwks.json"),
    );
  });

  it("fails as misconfigured when no auth endpoints are set", async () => {
    const { JwtVerificationError, verifyAccessToken } =
      await loadVerifierModule();
    (config as any).authUrl = "";
    (config as any).gotrueUrl = "";

    await expect(verifyAccessToken("token", "dashboard")).rejects.toMatchObject(
      {
        name: "JwtVerificationError",
        kind: "misconfigured",
      } satisfies { name: string; kind: string },
    );
  });

  it("rejects payloads with invalid subject ids", async () => {
    const { JwtVerificationError, verifyAccessToken } =
      await loadVerifierModule();
    jwtVerifyMock.mockResolvedValueOnce({ payload: { sub: "not-a-uuid" } });

    await expect(verifyAccessToken("token", "dashboard")).rejects.toMatchObject(
      {
        kind: "invalid",
        message: "Token user id is invalid",
      } satisfies { kind: string; message: string },
    );
  });

  it("normalizes expired JWT errors", async () => {
    const { verifyAccessToken } = await loadVerifierModule();
    const { JWTExpired } = await import("jose").then((m: any) => m.errors);
    jwtVerifyMock.mockRejectedValueOnce(new JWTExpired("expired token"));

    await expect(verifyAccessToken("token", "dashboard")).rejects.toMatchObject(
      {
        kind: "expired",
      },
    );
  });

  it("normalizes invalid JWT errors", async () => {
    const { verifyAccessToken } = await loadVerifierModule();
    const { JWSSignatureVerificationFailed } = await import("jose").then(
      (m: any) => m.errors,
    );
    jwtVerifyMock.mockRejectedValueOnce(
      new JWSSignatureVerificationFailed("bad sig"),
    );

    await expect(verifyAccessToken("token", "dashboard")).rejects.toMatchObject(
      {
        kind: "invalid",
      },
    );
  });

  it("normalizes transport/unavailable errors", async () => {
    const { verifyAccessToken } = await loadVerifierModule();
    jwtVerifyMock.mockRejectedValueOnce(new Error("network down"));

    await expect(verifyAccessToken("token", "dashboard")).rejects.toMatchObject(
      {
        kind: "unavailable",
      },
    );
  });
});
