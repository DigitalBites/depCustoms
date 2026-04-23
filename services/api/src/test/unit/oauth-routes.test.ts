import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

vi.mock("../../config.js", () => ({
  config: {
    requestBodyLimitBytes: 1048576,
    corsOrigins: ["http://localhost:3001"],
    authUrl: "http://api.local",
    authProxyEnabled: false,
    gotrueUrl: "",
    gotrueRequestTimeoutMs: 5000,
    environment: "test",
    logLevel: "info",
    internalServiceJwtPrivateJwk: JSON.stringify({
      kty: "RSA",
      alg: "RS256",
      n: "abc123",
      e: "AQAB",
      d: "secret-material",
      p: "private-p",
      q: "private-q",
    }),
    internalServiceJwtKeyId: "internal-service-1",
  },
}));

import { config } from "../../config.js";
import { oauthRoutes } from "../../routes/oauth.js";

const originalAuthUrl = config.authUrl;

afterEach(() => {
  (config as unknown as { authUrl: string }).authUrl = originalAuthUrl;
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OAuth metadata routes", () => {
  it("uses the configured auth URL for generic OAuth metadata", async () => {
    (config as unknown as { authUrl: string }).authUrl =
      "https://customs.local:8443";
    const app = new Hono().route("/", oauthRoutes);

    const res = await app.request(
      "http://localhost:3000/.well-known/oauth-authorization-server",
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.issuer).toBe("https://customs.local:8443");
    expect(body.authorization_endpoint).toBe(
      "https://customs.local:8443/oauth/authorize",
    );
  });

  it("uses the configured auth URL for MCP OAuth metadata", async () => {
    (config as unknown as { authUrl: string }).authUrl =
      "https://customs.local:8443";
    const app = new Hono().route("/", oauthRoutes);

    const authServerRes = await app.request(
      "http://localhost:3000/.well-known/oauth-authorization-server/mcp",
    );
    expect(authServerRes.status).toBe(200);

    const authServerBody = await authServerRes.json();
    expect(authServerBody.issuer).toBe("https://customs.local:8443");
    expect(authServerBody.authorization_endpoint).toBe(
      "https://customs.local:8443/oauth/authorize",
    );

    const resourceRes = await app.request(
      "http://localhost:3000/.well-known/oauth-protected-resource/mcp",
    );
    expect(resourceRes.status).toBe(200);

    const resourceBody = await resourceRes.json();
    expect(resourceBody.resource).toBe("https://customs.local:8443/mcp");
    expect(resourceBody.authorization_servers).toEqual([
      "https://customs.local:8443",
    ]);
  });

  it("honors forwarded https headers when no auth URL is configured", async () => {
    (config as unknown as { authUrl: string }).authUrl = "";
    const app = new Hono().route("/", oauthRoutes);

    const resourceRes = await app.request(
      "http://localhost:3000/.well-known/oauth-protected-resource/mcp",
      {
        headers: {
          host: "customs.local:8443",
          "x-forwarded-proto": "https",
          "x-forwarded-host": "customs.local:8443",
        },
      },
    );
    expect(resourceRes.status).toBe(200);

    const resourceBody = await resourceRes.json();
    expect(resourceBody.resource).toBe("https://customs.local:8443/mcp");
    expect(resourceBody.authorization_servers).toEqual([
      "https://customs.local:8443",
    ]);
  });

  it("returns 500 when GoTrue proxying is not configured", async () => {
    (config as any).authProxyEnabled = false;
    (config as any).gotrueUrl = "";
    const app = new Hono().route("/", oauthRoutes);

    const res = await app.request("http://localhost:3000/oauth/token", {
      method: "POST",
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: {
        code: "SERVER_MISCONFIGURED",
        message: "Auth service not configured",
        detail: null,
      },
    });
  });

  it("proxies OAuth requests to GoTrue and strips hop-by-hop headers", async () => {
    (config as any).authProxyEnabled = true;
    (config as any).gotrueUrl = "http://gotrue.local";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("proxied", {
          status: 201,
          headers: {
            "content-length": "7",
            "cache-control": "no-cache",
          },
        }),
      ),
    );

    const app = new Hono().route("/", oauthRoutes);
    const res = await app.request("http://localhost:3000/oauth/token?x=1", {
      method: "POST",
      headers: {
        authorization: "Bearer abc",
        "content-type": "application/json",
        "x-not-allowed": "drop",
      },
      body: JSON.stringify({ grant_type: "client_credentials" }),
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://gotrue.local/oauth/token?x=1",
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers),
      }),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toBe("proxied");
  });

  it("returns 503 when GoTrue is unavailable", async () => {
    (config as any).authProxyEnabled = true;
    (config as any).gotrueUrl = "http://gotrue.local";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("timeout"), { name: "AbortError" }),
        ),
    );

    const app = new Hono().route("/", oauthRoutes);
    const res = await app.request(
      "http://localhost:3000/.well-known/jwks.json",
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: {
        code: "AUTH_UNAVAILABLE",
        message: "Authentication service is temporarily unavailable",
        detail: null,
      },
    });
  });

  it("returns internal service JWKS when configured", async () => {
    (config as any).internalServiceJwtPrivateJwk = JSON.stringify({
      kty: "RSA",
      alg: "RS256",
      kid: "private-kid-ignored",
      n: "abc123",
      e: "AQAB",
      d: "secret-material",
      p: "private-p",
      q: "private-q",
    });
    (config as any).internalServiceJwtKeyId = "internal-service-1";
    const app = new Hono().route("/", oauthRoutes);

    const res = await app.request(
      "http://localhost:3000/.well-known/internal-service-jwks.json",
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      keys: [
        {
          kty: "RSA",
          alg: "RS256",
          kid: "internal-service-1",
          n: "abc123",
          e: "AQAB",
          use: "sig",
        },
      ],
    });
  });
});
