/**
 * Structured JSON logger for the Customs API.
 *
 * Every log line is a JSON object containing at minimum:
 *   { ts, level, service: 'api', msg, ...fields }
 *
 * Level filtering respects config.logLevel (LOG_LEVEL env var).
 * Errors go to stderr; everything else to stdout.
 *
 * Usage:
 *   import { log } from './logger.js';
 *   log.info('startup_config', { config: config.toLog() });
 *   log.warn('proxy_auth_failed', { reason: 'invalid_secret', proxy_id });
 *   log.error('db_error', { error: err.message });
 *   log.debug('connector_cache_hit', { connector: 'osv', package: 'lodash' });
 */

import { config } from "./config.js";

type Level = "debug" | "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

const LEVEL_RANK: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const configuredLevel: Level =
  config.logLevel in LEVEL_RANK ? (config.logLevel as Level) : "info";
const minRank = LEVEL_RANK[configuredLevel];

export function serializeError(err: unknown): LogFields {
  if (err instanceof Error) {
    return {
      error_name: err.name,
      error_message: err.message,
      ...(config.environment === "development" && err.stack
        ? { error_stack: err.stack }
        : {}),
    };
  }

  return {
    error_message: String(err),
  };
}

function write(level: Level, msg: string, fields?: LogFields): void {
  if (LEVEL_RANK[level] < minRank) return;

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: "api",
    msg,
    ...fields,
  });

  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

type Logger = {
  debug: (msg: string, fields?: LogFields) => void;
  info: (msg: string, fields?: LogFields) => void;
  warn: (msg: string, fields?: LogFields) => void;
  error: (msg: string, fields?: LogFields) => void;
  child: (fields: LogFields) => Logger;
};

function createLogger(baseFields: LogFields = {}): Logger {
  return {
    debug: (msg, fields) => write("debug", msg, { ...baseFields, ...fields }),
    info: (msg, fields) => write("info", msg, { ...baseFields, ...fields }),
    warn: (msg, fields) => write("warn", msg, { ...baseFields, ...fields }),
    error: (msg, fields) => write("error", msg, { ...baseFields, ...fields }),
    child: (fields) => createLogger({ ...baseFields, ...fields }),
  };
}

export const log = createLogger();
