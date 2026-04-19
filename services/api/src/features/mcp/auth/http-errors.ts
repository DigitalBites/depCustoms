import type { Context } from "hono";
import { config } from "../../../config.js";
import { resolvePublicBaseUrl } from "../../../http/public-base-url.js";
import type { McpAuthError } from "./service.js";

function toOAuthErrorCode(err: McpAuthError): string {
  if (err.status === 401) {
    return err.code === "MISSING_TOKEN" ? "invalid_request" : "invalid_token";
  }

  if (err.status === 403) {
    return "insufficient_scope";
  }

  return "server_error";
}

export function oauthErrorResponse(c: Context, err: McpAuthError): Response {
  const oauthError = toOAuthErrorCode(err);
  const publicBaseUrl = resolvePublicBaseUrl(
    c.req.url,
    c.req.raw.headers,
    config.authUrl,
  );
  const wwwAuthenticate = [
    `Bearer realm="customs-mcp"`,
    `error="${oauthError}"`,
    `error_description="${err.message.replaceAll('"', "'")}"`,
    `resource_metadata="${publicBaseUrl}/.well-known/oauth-protected-resource"`,
  ].join(", ");

  return c.json(
    {
      error: oauthError,
      error_description: err.message,
    },
    err.status as 401 | 403 | 500 | 503,
    {
      "WWW-Authenticate": wwwAuthenticate,
      "Cache-Control": "no-store",
    },
  );
}
