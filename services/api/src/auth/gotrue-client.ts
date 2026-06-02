import { config } from "../config.js";

export class GotrueDependencyError extends Error {
  readonly kind: "timeout" | "network";

  constructor(kind: "timeout" | "network", message: string) {
    super(message);
    this.name = "GotrueDependencyError";
    this.kind = kind;
  }
}

export function gotrueRequestTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(config.gotrueRequestTimeoutMs);
}

export function gotruePublicHeaders(): Record<string, string> {
  return config.gotrueAnonKey ? { apikey: config.gotrueAnonKey } : {};
}

export function withGotrueApiKeyHeader(headers: Headers): Headers {
  if (config.gotrueAnonKey && !headers.has("apikey")) {
    headers.set("apikey", config.gotrueAnonKey);
  }

  return headers;
}

export function normalizeGotrueDependencyError(
  err: unknown,
): GotrueDependencyError {
  if (err instanceof GotrueDependencyError) {
    return err;
  }

  if (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  ) {
    return new GotrueDependencyError("timeout", err.message);
  }

  return new GotrueDependencyError(
    "network",
    err instanceof Error ? err.message : String(err),
  );
}

export function isGotrueDependencyError(
  err: unknown,
): err is GotrueDependencyError {
  return err instanceof GotrueDependencyError;
}

export async function fetchGotrue(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = withGotrueApiKeyHeader(new Headers(init.headers));

  try {
    return await fetch(`${config.gotrueUrl}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? gotrueRequestTimeoutSignal(),
    });
  } catch (err) {
    throw normalizeGotrueDependencyError(err);
  }
}
