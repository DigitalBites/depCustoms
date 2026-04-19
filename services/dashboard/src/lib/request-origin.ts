import { config } from "@/config";

function getConfiguredPublicOrigin(): string | null {
  const candidates = [
    config.publicOrigin,
    process.env.NEXT_PUBLIC_AUTH_URL,
    process.env.NEXT_PUBLIC_API_URL,
    config.apiUrl,
    config.authUrl,
  ];

  for (const value of candidates) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.origin;
      }
    } catch {
      // Ignore malformed config values and continue to the next candidate.
    }
  }

  return null;
}

export function getSameOriginDebugInfo(request: Request) {
  return {
    expectedOrigin: getConfiguredPublicOrigin() ?? new URL(request.url).origin,
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    requestUrl: request.url,
  };
}

export function isSameOriginRequest(request: Request): boolean {
  const { expectedOrigin, origin, referer } = getSameOriginDebugInfo(request);

  if (origin) {
    return origin === expectedOrigin;
  }

  if (!referer) {
    return false;
  }

  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
}
