import {
  TENANT_PROXY_SCOPE,
  TENANT_PROXY_SCOPES,
  type TenantProxyScope,
} from "@customs/shared-constants";
import {
  check,
  pgTable,
  sql,
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
    tenant_scope: text("tenant_scope")
      .$type<TenantProxyScope>()
      .notNull()
      .default(TENANT_PROXY_SCOPE.OWNER_ONLY),
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
    check(
      "proxies_tenant_scope_check",
      sql`${t.tenant_scope} in (${sql.raw(
        textEnumValues(TENANT_PROXY_SCOPES),
      )})`,
    ),
    index("proxies_tenant_id_idx").on(t.tenant_id),
    uniqueIndex("proxies_proxy_id_idx").on(t.proxy_id),
  ],
);

function textEnumValues(values: readonly string[]): string {
  return values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");
}
