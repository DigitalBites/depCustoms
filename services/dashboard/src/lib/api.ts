import { createBrowserClient } from "./supabase-browser";
import { getApiErrorMessage } from "@/lib/api-error";
import { buildApiUrl } from "@/lib/api-path";
import { getPublicRuntimeConfig } from "@/lib/public-runtime-config";
import { redirectToLogin } from "@/lib/session-expiry";

/**
 * Fetch a Customs API endpoint with automatic auth header injection.
 *
 * Retrieves the current Supabase session token and attaches it as
 * `Authorization: Bearer <token>`. The Supabase client caches the session
 * in memory so repeated calls are not expensive.
 *
 * Throws a structured error on non-2xx responses matching the API error shape:
 *   { error: { code, message, detail } }
 */
const supabase = createBrowserClient();
const inflightGetRequests = new Map<string, Promise<unknown>>();
const recentGetResponses = new Map<
  string,
  { value: unknown; expiresAt: number }
>();
const RECENT_GET_TTL_MS = 1000;

function cloneApiResponse<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return value;
}

export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  let token: string | null = null;

  if (typeof window !== "undefined") {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? null;
    if (!token) {
      redirectToLogin();
      throw new Error("Session expired");
    }
  }

  const headers = new Headers(options.headers);

  if (
    options.body !== undefined &&
    options.body !== null &&
    !headers.has("Content-Type") &&
    !(typeof FormData !== "undefined" && options.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const url = buildApiUrl(getPublicRuntimeConfig().apiUrl, path);
  const method = (options.method ?? "GET").toUpperCase();
  const canDedupe =
    method === "GET" &&
    options.body === undefined &&
    options.signal === undefined;
  const dedupeKey = canDedupe ? `${method}:${url}` : null;

  if (dedupeKey) {
    const recent = recentGetResponses.get(dedupeKey);
    if (recent && recent.expiresAt > Date.now()) {
      return cloneApiResponse(recent.value);
    }
    if (recent) {
      recentGetResponses.delete(dedupeKey);
    }

    const inflight = inflightGetRequests.get(dedupeKey);
    if (inflight) {
      return inflight;
    }
  }

  const requestPromise = (async () => {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorPayload: {
        error?: { code?: string; message?: string; detail?: unknown };
      } = {};

      try {
        errorPayload = await response.json();
      } catch {
        // Non-JSON error body
      }

      const apiMessage =
        errorPayload.error?.message ??
        `Request failed with status ${response.status}`;
      const message = getApiErrorMessage(
        response.status,
        errorPayload.error?.code,
      );

      const err = new Error(message) as Error & {
        status: number;
        code: string | undefined;
        detail: unknown;
        apiMessage: string;
      };
      err.status = response.status;
      err.code = errorPayload.error?.code;
      err.detail = errorPayload.error?.detail;
      err.apiMessage = apiMessage;

      if (
        typeof window !== "undefined" &&
        (response.status === 401 || errorPayload.error?.code === "auth_failed")
      ) {
        redirectToLogin();
      }

      throw err;
    }

    if (response.status === 204) {
      return null;
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await response.text();
      return text === "" ? null : text;
    }

    const text = await response.text();
    if (text === "") {
      return null;
    }

    const parsed = JSON.parse(text) as unknown;
    if (dedupeKey) {
      recentGetResponses.set(dedupeKey, {
        value: parsed,
        expiresAt: Date.now() + RECENT_GET_TTL_MS,
      });
    }

    return parsed;
  })();

  if (!dedupeKey) {
    return requestPromise;
  }

  inflightGetRequests.set(dedupeKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    inflightGetRequests.delete(dedupeKey);
  }
}
