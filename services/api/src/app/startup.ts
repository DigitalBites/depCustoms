import { buildConnectors, registerAllFields } from "../connectors/registry.js";
import { setConnectors } from "../connectors/runtime.js";
import type { PackageIntelligenceConnector } from "../connectors/types.js";
import { db } from "../db/index.js";
import { log, serializeError } from "../logger.js";
import type { ApiReadinessState } from "./http-app.js";
import { checkDatabaseReadiness } from "./db-readiness.js";

export async function waitForDatabase(
  readiness: ApiReadinessState,
): Promise<void> {
  const INITIAL_DELAY_MS = 1_000;
  const MAX_DELAY_MS = 30_000;
  let attempt = 0;
  let delay = INITIAL_DELAY_MS;

  while (true) {
    attempt++;
    try {
      const readinessCheck = await checkDatabaseReadiness();
      if (!readinessCheck.ok) {
        throw new Error(
          `Missing required tables: ${readinessCheck.missingTables.join(", ")}`,
        );
      }
      readiness.dbReady = true;
      log.info("db_ready", { attempt });
      return;
    } catch (err) {
      log.warn("db_connecting", {
        attempt,
        retry_in_ms: delay,
        ...serializeError(err),
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    }
  }
}

export function initializeConnectors(): PackageIntelligenceConnector[] {
  const connectors = buildConnectors();
  setConnectors(connectors);

  return connectors;
}

export async function activateConnectors(
  connectors: PackageIntelligenceConnector[],
): Promise<void> {
  await Promise.all(
    connectors.map((connector) =>
      connector.initialize().catch((err) =>
        log.error("connector_initialize_failed", {
          connector: connector.id,
          ...serializeError(err),
        }),
      ),
    ),
  );

  await registerAllFields(db, connectors).catch((err) =>
    log.warn("connector_fields_registration_failed", {
      ...serializeError(err),
    }),
  );
}
