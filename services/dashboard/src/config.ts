/**
 * Central configuration for the Customs dashboard.
 *
 * Browser-facing public config is injected at request time by the root layout.
 * This module is used by the server-side dashboard runtime, middleware, and
 * route handlers to read env-backed configuration at process startup.
 *
 * All values are read once at module load time. A server restart is required
 * to pick up env var changes.
 *
 * Call config.toLog() at startup to emit a sanitized snapshot without secret
 * fragments or internal service URLs.
 */

class DashboardConfig {
  // General
  readonly port: string;

  // Auth — server runtime
  readonly authUrl: string;
  readonly anonKey: string;
  readonly publicOrigin: string;

  // API — server runtime
  readonly apiUrl: string;

  // API — server only (same-origin dev proxy and SSE proxy route handlers)
  readonly apiInternalUrl: string;
  readonly apiProxyEnabled: boolean;

  constructor() {
    this.port = process.env.PORT ?? "3001";
    // Server-side session refresh and SSR auth checks should prefer an
    // operator-provided internal auth URL when available.
    this.authUrl =
      process.env.AUTH_INTERNAL_URL ??
      process.env.AUTH_URL ??
      process.env.NEXT_PUBLIC_AUTH_URL ??
      "";
    this.anonKey = process.env.NEXT_PUBLIC_GOTRUE_ANON_KEY ?? "";
    this.publicOrigin = process.env.PUBLIC_ORIGIN ?? "";
    this.apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
    this.apiInternalUrl = process.env.API_INTERNAL_URL ?? "";
    this.apiProxyEnabled = process.env.DASHBOARD_API_PROXY_ENABLED === "true";
  }

  /**
   * Returns a sanitized snapshot of the current configuration suitable for
   * structured logging.
   */
  toLog(): Record<string, unknown> {
    return {
      general: {
        port: this.port,
      },
      auth: {
        url: this.authUrl,
        anon_key_configured: this.anonKey !== "",
        public_origin: this.publicOrigin || undefined,
      },
      api: {
        public_url: this.apiUrl,
        internal_url_configured: this.apiInternalUrl !== "",
        same_origin_dev_proxy_enabled: this.apiProxyEnabled,
      },
    };
  }
}

export const config = new DashboardConfig();
