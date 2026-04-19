import { config } from "./config.js";
import { log, serializeError } from "./logger.js";
import { buildApiApp, type ApiReadinessState } from "./app/http-app.js";
import {
  activateConnectors,
  initializeConnectors,
  waitForDatabase,
} from "./app/startup.js";
import { createApiServer } from "./app/server.js";

const port = config.port;

async function start() {
  log.info("starting", { port, environment: config.environment });
  log.info("startup_config", { config: config.toLog() });

  const readiness: ApiReadinessState = { dbReady: false };
  const app = buildApiApp(readiness);
  const connectors = initializeConnectors();
  const server = createApiServer(app, connectors);

  server.listen(port, () => {
    log.info("listening", { port });
    void (async () => {
      await waitForDatabase(readiness);
      await activateConnectors(connectors);
    })();
  });

  process.on("SIGTERM", () => {
    void (async () => {
      log.info("shutdown_initiated");
      await Promise.all(
        connectors.map((connector) => connector.shutdown().catch(() => {})),
      );
      server.close(() => process.exit(0));
    })();
  });
}

start().catch((err) => {
  log.error("startup_failed", { ...serializeError(err) });
  process.exit(1);
});
