/**
 * Contributor risk connector configuration.
 *
 * Reads all CONNECTOR_CONTRIBUTOR_* environment variables once at construction
 * time. Call logStartup() during startup to emit a structured log line
 * covering every setting, including the enabled/disabled state.
 *
 * Implements ConnectorConfig so it can be passed directly to ContributorConnector
 * and stored on connector.config (used by the cache layer for TTL comparisons
 * and by the gateway for per-request deadlines).
 */

import type { ConnectorConfig } from "../types.js";
import { log } from "../../logger.js";

export class ContributorConnectorConfig implements ConnectorConfig {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly cacheTtlSeconds: number;
  readonly responseTimeoutMs: number;
  readonly backgroundTimeoutMs: number;
  /**
   * When set, overrides ALL TTL values (connector_cache and publisher cache)
   * for this connector. Useful during development to avoid re-hitting public
   * registry APIs on every restart. Not for use in production.
   *
   * Example: set to 604800 (1 week) to cache aggressively during local dev.
   */
  readonly cacheTtlOverrideSeconds: number | null;

  constructor() {
    this.enabled = process.env.CONNECTOR_CONTRIBUTOR_ENABLED !== "false";
    this.responseTimeoutMs = parseInt(
      process.env.CONNECTOR_CONTRIBUTOR_RESPONSE_TIMEOUT_MS ?? "3000",
      10,
    );

    const overrideRaw =
      process.env.CONNECTOR_CONTRIBUTOR_CACHE_TTL_OVERRIDE_SECONDS;
    this.cacheTtlOverrideSeconds = overrideRaw
      ? parseInt(overrideRaw, 10)
      : null;

    const defaultCacheTtl = parseInt(
      process.env.CONNECTOR_CONTRIBUTOR_CACHE_TTL_SECONDS ?? "3600",
      10,
    );

    // Contributor facts are DB-backed now; these retained ConnectorConfig fields
    // satisfy the shared interface but no longer have a separate env surface.
    this.baseUrl = "https://registry.npmjs.org";
    this.backgroundTimeoutMs = 30000;
    this.cacheTtlSeconds = this.cacheTtlOverrideSeconds ?? defaultCacheTtl;
  }

  logStartup(): void {
    log.info("connector_config", {
      connector: "contributor",
      enabled: this.enabled,
      cache_ttl_seconds: this.cacheTtlSeconds,
      response_timeout_ms: this.responseTimeoutMs,
      cache_ttl_override_seconds: this.cacheTtlOverrideSeconds,
    });
  }
}
