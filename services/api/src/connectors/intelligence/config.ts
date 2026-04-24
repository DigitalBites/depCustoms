import type { ConnectorConfig } from "../types.js";
import { log } from "../../logger.js";

export class IntelligenceConnectorConfig implements ConnectorConfig {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly cacheTtlSeconds: number;
  readonly responseTimeoutMs: number;
  readonly backgroundTimeoutMs: number;

  constructor() {
    this.enabled = process.env.CONNECTOR_INTELLIGENCE_ENABLED === "true";
    this.baseUrl =
      process.env.INTELLIGENCE_API_URL ?? "http://intelligence:8000";
    this.cacheTtlSeconds = parseInt(
      process.env.CONNECTOR_INTELLIGENCE_CACHE_TTL_SECONDS ?? "3600",
      10,
    );
    this.responseTimeoutMs = parseInt(
      process.env.CONNECTOR_INTELLIGENCE_RESPONSE_TIMEOUT_MS ?? "1500",
      10,
    );
    this.backgroundTimeoutMs = parseInt(
      process.env.CONNECTOR_INTELLIGENCE_BACKGROUND_TIMEOUT_MS ?? "10000",
      10,
    );
  }

  logStartup(): void {
    log.info("connector_config", {
      connector: "intelligence",
      enabled: this.enabled,
      api_url: this.baseUrl,
      cache_ttl_seconds: this.cacheTtlSeconds,
      response_timeout_ms: this.responseTimeoutMs,
      background_timeout_ms: this.backgroundTimeoutMs,
    });
  }
}
