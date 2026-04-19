import { createBrowserClient as _createBrowserClient } from "@supabase/ssr";
import { getPublicRuntimeConfig } from "@/lib/public-runtime-config";

type SupabaseBrowserClient = ReturnType<typeof _createBrowserClient>;

// Singleton — one client per browser tab. Every new instance registers its own
// onAuthStateChange listener and autoRefreshToken timer; creating one per
// apiFetch() call floods the microtask queue with competing Promise chains.
let _client: SupabaseBrowserClient | null = null;

function ensureRandomUuid(): void {
  if (typeof window === "undefined") return;

  const cryptoObj = window.crypto;
  if (!cryptoObj || typeof cryptoObj.randomUUID === "function") {
    return;
  }
  if (typeof cryptoObj.getRandomValues !== "function") {
    return;
  }

  const randomUuid = () => {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10, 16).join(""),
    ].join("-");
  };

  try {
    Object.defineProperty(cryptoObj, "randomUUID", {
      value: randomUuid,
      configurable: true,
      writable: true,
    });
  } catch {
    // Fallback assignment for environments that reject defineProperty here.
    // @ts-expect-error runtime polyfill
    cryptoObj.randomUUID = randomUuid;
  }
}

export function createBrowserClient(): SupabaseBrowserClient {
  const runtimeConfig = getPublicRuntimeConfig();

  if (typeof window === "undefined") {
    // SSR path: return a fresh client (not stored — server renders are isolated).
    return _createBrowserClient(runtimeConfig.authUrl, runtimeConfig.anonKey);
  }
  if (!_client) {
    ensureRandomUuid();
    _client = _createBrowserClient(
      runtimeConfig.authUrl,
      runtimeConfig.anonKey,
    );
  }
  return _client;
}
