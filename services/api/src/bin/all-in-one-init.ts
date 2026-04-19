import { runBundledBootstrapInitialization } from "../bootstrap/bundled-init.js";

async function main() {
  const result = await runBundledBootstrapInitialization(process.env);
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      service: "bootstrap-init",
      msg: "bundled initialization complete",
      result,
    }),
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[bootstrap-init] ${message}`);
  process.exit(1);
});
