import { spawn } from "node:child_process";
async function main() {
  await runDbPush();
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      service: "bootstrap-db-push",
      msg: "api schema pushed",
    }),
  );
}

function runDbPush(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "node",
      [
        "./node_modules/drizzle-kit/bin.cjs",
        "push",
        "--config",
        "drizzle.config.ts",
        "--force",
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
      },
    );

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(`drizzle-kit push exited with code ${code ?? "unknown"}`),
      );
    });
  });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[bootstrap-db-push] ${message}`);
  process.exit(1);
});
