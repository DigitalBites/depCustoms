import { spawn } from "node:child_process";
import postgres from "postgres";

async function main() {
  const shouldPush = await shouldRunDbPush();
  if (!shouldPush) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        service: "bootstrap-db-push",
        msg: "api schema push skipped",
        reason: "public schema already has tables",
      }),
    );
    return;
  }

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

async function shouldRunDbPush(): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 5,
    prepare: false,
  });

  try {
    const rows = await sql<{ table_count: string }[]>`
      select count(*)::text as table_count
      from pg_catalog.pg_tables
      where schemaname = 'public'
    `;
    const tableCount = Number(rows[0]?.table_count ?? "0");
    return tableCount === 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
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
