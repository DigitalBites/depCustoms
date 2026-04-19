import postgres from "postgres";

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getSchemaName(): string {
  const schema = getRequiredEnv("GOTRUE_DB_SCHEMA");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(
      `GOTRUE_DB_SCHEMA must be a simple Postgres identifier: ${schema}`,
    );
  }
  return schema;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function main() {
  const databaseUrl = getRequiredEnv("GOTRUE_DB_DATABASE_URL");
  const schema = getSchemaName();
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 5,
    prepare: false,
  });

  try {
    await sql.unsafe(`create schema if not exists ${quoteIdentifier(schema)}`);
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        service: "bootstrap-gotrue-schema",
        msg: "ensured GoTrue schema exists",
        schema,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[bootstrap-gotrue-schema] ${message}`);
  process.exit(1);
});
