import { requireConfiguredPublicBaseUrl } from "../http/public-base-url.js";

export function buildProtectedResourceMetadata(
  requestUrl: string,
  headers?: Headers,
  configuredBaseUrl?: string,
) {
  void requestUrl;
  void headers;
  const baseUrl = requireConfiguredPublicBaseUrl(configuredBaseUrl);

  return {
    resource: `${baseUrl}/api/mcp`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ["header"],
  };
}

export function buildAuthorizationServerMetadata(
  requestUrl: string,
  headers?: Headers,
  configuredBaseUrl?: string,
) {
  void requestUrl;
  void headers;
  const baseUrl = requireConfiguredPublicBaseUrl(configuredBaseUrl);

  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    userinfo_endpoint: `${baseUrl}/oauth/userinfo`,
    registration_endpoint: `${baseUrl}/oauth/clients/register`,
    scopes_supported: ["openid", "profile", "email", "phone"],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256", "HS256", "ES256"],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
      "none",
    ],
    claims_supported: [
      "sub",
      "aud",
      "iss",
      "exp",
      "iat",
      "auth_time",
      "nonce",
      "email",
      "email_verified",
      "phone_number",
      "phone_number_verified",
      "name",
      "picture",
      "preferred_username",
      "updated_at",
    ],
    code_challenge_methods_supported: ["S256"],
  };
}
