import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

const REQUIRED_PUBLIC_TABLES = [
  "tenants",
  "tenant_entitlements",
  "projects",
  "project_tokens",
  "policies",
  "rules",
] as const;

export type DatabaseReadinessCheck = {
  ok: boolean;
  missingTables: string[];
};

export async function checkDatabaseReadiness(): Promise<DatabaseReadinessCheck> {
  await db.execute(sql`SELECT 1`);

  const tableRows = await db.execute<{ tablename: string }>(sql`
    SELECT tablename
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (${sql.join(
        REQUIRED_PUBLIC_TABLES.map((tableName) => sql`${tableName}`),
        sql`, `,
      )})
  `);

  const presentTables = new Set(tableRows.map((row) => row.tablename));
  const missingTables = REQUIRED_PUBLIC_TABLES.filter(
    (tableName) => !presentTables.has(tableName),
  );

  return {
    ok: missingTables.length === 0,
    missingTables: [...missingTables],
  };
}
