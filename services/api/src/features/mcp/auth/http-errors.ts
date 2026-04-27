import type { Context } from "hono";
import { config } from "../../../config.js";
import { requireConfiguredPublicBaseUrl } from "../../../http/public-base-url.js";
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
  const wwwAuthenticate = [
    `Bearer realm="customs-mcp"`,
    `error="${oauthError}"`,
    `error_description="${err.message.replaceAll('"', "'")}"`,
  ].join(", ");

  let resourceMetadata: string | null = null;
  try {
    resourceMetadata = `${requireConfiguredPublicBaseUrl(config.authUrl)}/.well-known/oauth-protected-resource`;
  } catch {
    resourceMetadata = null;
  }

  const challenge = resourceMetadata
    ? `${wwwAuthenticate}, resource_metadata="${resourceMetadata}"`
    : wwwAuthenticate;

  return c.json(
    {
      error: oauthError,
      error_description: err.message,
    },
    err.status as 401 | 403 | 500 | 503,
    {
      "WWW-Authenticate": challenge,
      "Cache-Control": "no-store",
    },
  );
}
