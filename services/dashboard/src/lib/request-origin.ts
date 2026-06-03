import { config } from "@/config";

function firstHeaderValue(value: string | null): string {
  return value?.split(",")[0]?.trim() ?? "";
}

function resolveForwardedOrigin(headers: Headers): string | null {
  const host = firstHeaderValue(headers.get("x-forwarded-host"));
  if (!host) {
    return null;
  }

  const proto = firstHeaderValue(headers.get("x-forwarded-proto")) || "https";
  if (proto !== "http" && proto !== "https") {
    return null;
  }

  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

export function resolveExpectedDashboardOrigin(
  requestUrl: string,
  publicOrigin = config.publicOrigin,
  headers?: Headers,
): string {
  if (publicOrigin) {
    try {
      const url = new URL(publicOrigin);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.origin;
      }
    } catch {
      // Invalid PUBLIC_ORIGIN should not widen the trust boundary.
    }
  }

  if (headers) {
    const forwardedOrigin = resolveForwardedOrigin(headers);
    if (forwardedOrigin) {
      return forwardedOrigin;
    }
  }

  return new URL(requestUrl).origin;
}

export function getSameOriginDebugInfo(
  request: Request,
  publicOrigin = config.publicOrigin,
) {
  return {
    expectedOrigin: resolveExpectedDashboardOrigin(
      request.url,
      publicOrigin,
      request.headers,
    ),
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    requestUrl: request.url,
  };
}

export function isSameOriginRequest(
  request: Request,
  publicOrigin = config.publicOrigin,
): boolean {
  const { expectedOrigin, origin, referer } = getSameOriginDebugInfo(
    request,
    publicOrigin,
  );

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
