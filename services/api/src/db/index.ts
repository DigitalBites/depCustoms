import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { config } from "../config.js";

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

const client = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });

export type DB = typeof db;
