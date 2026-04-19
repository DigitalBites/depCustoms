/**
 * OSV connector configuration.
 *
 * Reads all CONNECTOR_OSV_* environment variables once at construction time.
 * Call logStartup() during startup to emit a single structured log line
 * covering every setting — including the enabled/disabled state.
 *
 * Implements ConnectorConfig so it can be passed directly to OsvConnector
 * and stored on connector.config (used by the cache layer for TTL comparisons
 * and by the gateway for the per-request response deadline).
 */

import type { ConnectorConfig } from "../types.js";
import { log } from "../../logger.js";

export class OsvConnectorConfig implements ConnectorConfig {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly cacheTtlSeconds: number;
  readonly responseTimeoutMs: number;
  readonly backgroundTimeoutMs: number;

  constructor() {
    this.enabled = process.env.CONNECTOR_OSV_ENABLED !== "false";
    this.baseUrl = process.env.OSV_API_URL ?? "https://api.osv.dev";
    this.cacheTtlSeconds = parseInt(
      process.env.CONNECTOR_OSV_CACHE_TTL_SECONDS ?? "3600",
      10,
    );
    this.responseTimeoutMs = parseInt(
      process.env.CONNECTOR_OSV_RESPONSE_TIMEOUT_MS ?? "2000",
      10,
    );
    this.backgroundTimeoutMs = parseInt(
      process.env.CONNECTOR_OSV_BACKGROUND_TIMEOUT_MS ?? "30000",
      10,
    );
  }

  /**
   * Emit a structured startup log line covering all OSV config values.
   * Always called — logs disabled state explicitly so operators know why
   * CVE checks are inactive without having to dig through env vars.
   */
  logStartup(): void {
    log.info("connector_config", {
      connector: "osv",
      enabled: this.enabled,
      api_url: this.baseUrl,
      cache_ttl_seconds: this.cacheTtlSeconds,
      response_timeout_ms: this.responseTimeoutMs,
      background_timeout_ms: this.backgroundTimeoutMs,
    });
  }
}
