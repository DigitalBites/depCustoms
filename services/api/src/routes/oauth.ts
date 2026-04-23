import { Hono, type Context } from "hono";
import { getInternalServiceJwks } from "../auth/internal-service-jwt.js";
import { config } from "../config.js";
import { errorBody } from "../http/responses.js";
import { log } from "../logger.js";
import {
  buildGotrueProxyHeaders,
  buildGotrueProxyResponseHeaders,
} from "../auth/gotrue-proxy.js";
import {
  gotrueRequestTimeoutSignal,
  isGotrueDependencyError,
  normalizeGotrueDependencyError,
} from "../auth/gotrue-client.js";
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
} from "../auth/oauth-metadata.js";

export const oauthRoutes = new Hono();

oauthRoutes.get("/.well-known/oauth-protected-resource", (c) =>
  c.json(
    buildProtectedResourceMetadata(
      c.req.url,
      c.req.raw.headers,
      config.authUrl,
    ),
  ),
);
oauthRoutes.get("/.well-known/oauth-protected-resource/mcp", (c) =>
  c.json(
    buildProtectedResourceMetadata(
      c.req.url,
      c.req.raw.headers,
      config.authUrl,
    ),
  ),
);
oauthRoutes.get("/.well-known/oauth-authorization-server", (c) =>
  c.json(
    buildAuthorizationServerMetadata(
      c.req.url,
      c.req.raw.headers,
      config.authUrl,
    ),
  ),
);
oauthRoutes.get("/.well-known/oauth-authorization-server/mcp", (c) =>
  c.json(
    buildAuthorizationServerMetadata(
      c.req.url,
      c.req.raw.headers,
      config.authUrl,
    ),
  ),
);
oauthRoutes.get("/.well-known/openid-configuration", (c) =>
  c.json(
    buildAuthorizationServerMetadata(
      c.req.url,
      c.req.raw.headers,
      config.authUrl,
    ),
  ),
);
oauthRoutes.get("/.well-known/openid-configuration/mcp", (c) =>
  c.json(
    buildAuthorizationServerMetadata(
      c.req.url,
      c.req.raw.headers,
      config.authUrl,
    ),
  ),
);
oauthRoutes.get("/mcp/.well-known/openid-configuration", (c) =>
  c.json(
    buildAuthorizationServerMetadata(
      c.req.url,
      c.req.raw.headers,
      config.authUrl,
    ),
  ),
);

oauthRoutes.all("/auth/v1/*", (c) =>
  proxyToGotrue(c, c.req.path.replace("/auth/v1", "") || "/"),
);
oauthRoutes.all("/oauth/*", (c) => proxyToGotrue(c, c.req.path));
oauthRoutes.get("/.well-known/jwks.json", (c) => proxyToGotrue(c, c.req.path));
oauthRoutes.get("/.well-known/internal-service-jwks.json", (c) =>
  c.json(getInternalServiceJwks()),
);

async function proxyToGotrue(c: Context, gotruePath: string) {
  if (!config.authProxyEnabled || !config.gotrueUrl) {
    return c.json(
      errorBody("SERVER_MISCONFIGURED", "Auth service not configured", null),
      500,
    );
  }

  const qs = c.req.url.includes("?")
    ? c.req.url.slice(c.req.url.indexOf("?"))
    : "";
  const url = `${config.gotrueUrl}${gotruePath}${qs}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: c.req.method,
      headers: buildGotrueProxyHeaders(c.req.raw.headers),
      body: ["GET", "HEAD"].includes(c.req.method) ? undefined : c.req.raw.body,
      signal: gotrueRequestTimeoutSignal(),
      redirect: "manual",
      // @ts-expect-error -- duplex is required for streaming body passthrough in Node fetch.
      duplex: "half",
    });
  } catch (err) {
    const normalized = normalizeGotrueDependencyError(err);
    if (isGotrueDependencyError(normalized)) {
      log.warn("gotrue_proxy_unavailable", {
        path: gotruePath,
        kind: normalized.kind,
        error: normalized.message,
      });
      return c.json(
        errorBody(
          "AUTH_UNAVAILABLE",
          "Authentication service is temporarily unavailable",
          null,
        ),
        503,
      );
    }
    throw err;
  }

  return new Response(resp.body, {
    status: resp.status,
    headers: buildGotrueProxyResponseHeaders(resp.headers),
  });
}
