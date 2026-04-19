const GOTRUE_PROXY_HEADER_ALLOWLIST = [
  "accept",
  "accept-language",
  "apikey",
  "authorization",
  "cookie",
  "content-type",
  "x-client-info",
  "user-agent",
  "prefer",
  "range",
  "if-none-match",
  "if-modified-since",
] as const;

export function buildGotrueProxyHeaders(source: Headers): Headers {
  const headers = new Headers();

  for (const name of GOTRUE_PROXY_HEADER_ALLOWLIST) {
    const value = source.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  return headers;
}

const GOTRUE_RESPONSE_HEADER_BLOCKLIST = [
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "transfer-encoding",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade",
] as const;

export function buildGotrueProxyResponseHeaders(source: Headers): Headers {
  const headers = new Headers(source);

  for (const name of GOTRUE_RESPONSE_HEADER_BLOCKLIST) {
    headers.delete(name);
  }

  return headers;
}
