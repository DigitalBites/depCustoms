import { VALID_TO_INFINITY_SQL_TIMESTAMPTZ } from "@customs/shared-constants";
import { sql as drizzleSql } from "drizzle-orm";

export {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  bigint,
  jsonb,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
export { sql } from "drizzle-orm";

export const VALID_TO_INFINITY_SQL = drizzleSql.raw(
  VALID_TO_INFINITY_SQL_TIMESTAMPTZ,
);
