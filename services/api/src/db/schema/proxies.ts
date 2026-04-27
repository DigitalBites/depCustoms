import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "./shared.js";
import { tenants } from "./tenancy.js";

export const proxies = pgTable(
  "proxies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    proxy_id: uuid("proxy_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    secret_hash: text("secret_hash").notNull(),
    secret_prev_hash: text("secret_prev_hash"),
    secret_prev_expires_at: timestamp("secret_prev_expires_at", {
      withTimezone: true,
    }),
    secret_prefix: text("secret_prefix").notNull(),
    disabled_at: timestamp("disabled_at", { withTimezone: true }),
    secret_rotated_at: timestamp("secret_rotated_at", { withTimezone: true }),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("proxies_tenant_id_idx").on(t.tenant_id),
    uniqueIndex("proxies_proxy_id_idx").on(t.proxy_id),
  ],
);
