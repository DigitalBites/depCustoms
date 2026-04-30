/**
 * Central configuration for the Customs API.
 *
 * All environment variables are read once at module load time. Routes and
 * middleware import `config` from this module instead of reading process.env
 * directly. A restart is required to pick up env var changes.
 *
 * Call config.toLog() at startup to emit a sanitized snapshot; sensitive fields
 * are reduced to presence/absence flags so secret material never appears in
 * logs.
 */

class ApiConfig {
  // General
  readonly environment: string;
  readonly logLevel: string;

  // Server
  readonly port: number;
  readonly requestBodyLimitBytes: number;
  readonly recordUsageMaxEvents: number;
  readonly proxyJwtTtlSeconds: number;
  readonly internalServiceJwtPrivateJwk: string;
  readonly internalServiceJwtKeyId: string;

  // Database
  readonly databaseUrl: string;

  // Auth (GoTrue)
  readonly authUrl: string;
  readonly authProxyEnabled: boolean;
  readonly gotrueUrl: string;
  readonly gotrueAnonKey: string;
  readonly gotrueServiceRoleKey: string;
  readonly gotrueHookSecret: string;
  readonly bootstrapFirstUserSecret: string;
  readonly gotrueRequestTimeoutMs: number;

  // CORS
  readonly corsOrigins: string[];

  constructor() {
    this.environment = process.env.ENVIRONMENT ?? "development";
    this.logLevel = process.env.LOG_LEVEL ?? "info";
    this.port = parseInt(process.env.PORT ?? "3000", 10);
    this.requestBodyLimitBytes = parseInt(
      process.env.API_REQUEST_BODY_LIMIT_BYTES ?? "1048576",
      10,
    );
    this.recordUsageMaxEvents = parseInt(
      process.env.API_RECORD_USAGE_MAX_EVENTS ?? "1000",
      10,
    );
    this.proxyJwtTtlSeconds = parseBoundedInt(
      process.env.PROXY_JWT_TTL_SECONDS ?? "900",
      "PROXY_JWT_TTL_SECONDS",
      300,
      1800,
    );
    this.internalServiceJwtPrivateJwk = requireEnv(
      "INTERNAL_SERVICE_JWT_PRIVATE_JWK",
    );
    this.internalServiceJwtKeyId =
      process.env.INTERNAL_SERVICE_JWT_KEY_ID ?? "internal-service-1";
    this.databaseUrl = process.env.DATABASE_URL ?? "";
    this.authUrl = process.env.AUTH_URL ?? "";
    this.authProxyEnabled =
      (process.env.AUTH_PROXY_ENABLED ?? "true") === "true";
    this.gotrueUrl = process.env.GOTRUE_URL ?? "";
    this.gotrueAnonKey = process.env.GOTRUE_ANON_KEY ?? "";
    this.gotrueServiceRoleKey = process.env.GOTRUE_SERVICE_ROLE_KEY ?? "";
    this.gotrueHookSecret = process.env.GOTRUE_HOOK_SECRET ?? "";
    this.bootstrapFirstUserSecret =
      process.env.BOOTSTRAP_FIRST_USER_SECRET ?? "";
    this.gotrueRequestTimeoutMs = parseInt(
      process.env.GOTRUE_REQUEST_TIMEOUT_MS ?? "5000",
      10,
    );
    this.corsOrigins = (process.env.API_CORS_ORIGIN ?? "http://localhost:3001")
      .split(",")
      .map((o) => o.trim());
  }

  /**
   * Returns a sanitized snapshot of the current configuration suitable for
   * structured logging. Secret-bearing values are represented only as
   * presence/absence booleans.
   */
  toLog(): Record<string, unknown> {
    return {
      general: {
        environment: this.environment,
        log_level: this.logLevel,
      },
      server: {
        port: this.port,
        request_body_limit_bytes: this.requestBodyLimitBytes,
        record_usage_max_events: this.recordUsageMaxEvents,
        proxy_jwt_ttl_seconds: this.proxyJwtTtlSeconds,
        internal_service_jwt_private_jwk_configured:
          this.internalServiceJwtPrivateJwk !== "",
        internal_service_jwt_key_id: this.internalServiceJwtKeyId,
      },
      database: {
        configured: this.databaseUrl !== "",
      },
      auth: {
        auth_url: this.authUrl,
        auth_proxy_enabled: this.authProxyEnabled,
        gotrue_url: this.gotrueUrl,
        anon_key_configured: this.gotrueAnonKey !== "",
        service_role_key_configured: this.gotrueServiceRoleKey !== "",
        hook_secret_configured: this.gotrueHookSecret !== "",
        bootstrap_first_user_secret_configured:
          this.bootstrapFirstUserSecret !== "",
        request_timeout_ms: this.gotrueRequestTimeoutMs,
      },
      cors: {
        origins: this.corsOrigins,
      },
    };
  }
}

export const config = new ApiConfig();

function parseBoundedInt(
  value: string,
  name: string,
  min: number,
  max: number,
): number {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be a valid integer`);
  }
  if (parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
