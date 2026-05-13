/**
 * Service-integration tests: DB constraint validation.
 *
 * These tests require a real Postgres database (DATABASE_URL env var).
 * They import service internals (db, schema) and exercise constraints that
 * cannot be triggered through the public API — DB-level CHECK, unique, and FK
 * violations only reachable via direct Drizzle inserts.
 *
 * Run via: make test-service-integration (CI integration phase, before server starts)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import { db } from "../../db/index.js";
import {
  tenants,
  projects,
  project_tokens,
  policies,
  policy_rule_bindings,
  rules,
  proxies,
  tenant_entitlements,
  events,
} from "../../db/schema.js";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if err carries a PostgreSQL constraint violation code. */
function isConstraintViolation(err: unknown, code?: string): boolean {
  const e = err as any;
  // The postgres driver wraps the pg error; the code is on the cause or the
  // error itself depending on how drizzle surfaces it.
  const errCode: string | undefined = e?.code ?? e?.cause?.code;
  const constraintCodes = ["23502", "23503", "23505", "23514"];
  return code ? errCode === code : constraintCodes.includes(errCode ?? "");
}

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const FK_VIOLATION = "23503";

// ---------------------------------------------------------------------------
// Test tenant — created once, deleted in afterAll (cascades all child rows).
// ---------------------------------------------------------------------------
let tenantId: string;
let projectId: string;
let policyId: string;
let tokenId: string;
const TEST_USER_ID = "00000000-0000-0000-0000-000000000099";

beforeAll(async () => {
  tenantId = randomUUID();

  const [tenant] = await db
    .insert(tenants)
    .values({ id: tenantId, name: `schema-test-${tenantId.slice(0, 8)}` })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({ tenant_id: tenant.id, name: "schema-test-project" })
    .returning();

  projectId = project.id;

  const [policy] = await db
    .insert(policies)
    .values({
      tenant_id: tenant.id,
      name: "schema-test-policy",
      scope: "global",
      status: "active",
      enforcement_mode: "enforcing",
      priority: 100,
    })
    .returning();

  policyId = policy.id;

  const rawToken = randomBytes(16).toString("hex");
  const [token] = await db
    .insert(project_tokens)
    .values({
      project_id: projectId,
      tenant_id: tenantId,
      name: "schema-test-token",
      created_by_user_id: TEST_USER_ID,
      token_hash: createHash("sha256").update(rawToken).digest("hex"),
      token_prefix: rawToken.slice(-6),
    })
    .returning();

  tokenId = token.id;
});

afterAll(async () => {
  // Cascade delete cleans up all child rows.
  await db.delete(tenants).where(eq(tenants.id, tenantId));
});

// ---------------------------------------------------------------------------
// rules JSONB — basic insert/delete round-trip
// ---------------------------------------------------------------------------

describe("rules table — JSONB condition and action", () => {
  it("accepts a valid leaf condition rule", async () => {
    const [row] = await db
      .insert(rules)
      .values({
        tenant_id: tenantId,
        name: "test-block-critical",
        target_entity: "artifact",
        condition: {
          field: "source.osv.critical_count",
          operator: "gt",
          value: 0,
        },
        action: {
          type: "violation",
          severity: "critical",
          code: "OSV_CRITICAL_CVE",
          enforcement_mode: "enforcing",
        },
      })
      .returning();
    await db.insert(policy_rule_bindings).values({
      tenant_id: tenantId,
      policy_id: policyId,
      rule_id: row.id,
      enabled: true,
      order_index: 0,
    });

    expect(row.id).toBeDefined();
    expect(row.condition).toMatchObject({
      field: "source.osv.critical_count",
      operator: "gt",
      value: 0,
    });
    expect(row.action).toMatchObject({
      type: "violation",
      severity: "critical",
    });

    await db.delete(rules).where(eq(rules.id, row.id));
  });

  it("accepts a nested all/any condition rule", async () => {
    const [row] = await db
      .insert(rules)
      .values({
        tenant_id: tenantId,
        name: "test-nested-condition",
        target_entity: "artifact",
        condition: {
          any: [
            { field: "source.osv.critical_count", operator: "gt", value: 0 },
            { field: "source.osv.high_count", operator: "gt", value: 5 },
          ],
        },
        action: {
          type: "violation",
          severity: "high",
          code: "OSV_HIGH_CVE",
          enforcement_mode: "enforcing",
        },
      })
      .returning();
    await db.insert(policy_rule_bindings).values({
      tenant_id: tenantId,
      policy_id: policyId,
      rule_id: row.id,
      enabled: true,
      order_index: 1,
    });

    expect(row.id).toBeDefined();
    await db.delete(rules).where(eq(rules.id, row.id));
  });

  it("accepts a warning (advisory) action rule", async () => {
    const [row] = await db
      .insert(rules)
      .values({
        tenant_id: tenantId,
        name: "test-advisory-medium",
        target_entity: "artifact",
        condition: {
          field: "source.osv.medium_count",
          operator: "gt",
          value: 0,
        },
        action: {
          type: "warning",
          severity: "medium",
          code: "OSV_MEDIUM_CVE",
          enforcement_mode: "advisory",
        },
      })
      .returning();
    await db.insert(policy_rule_bindings).values({
      tenant_id: tenantId,
      policy_id: policyId,
      rule_id: row.id,
      enabled: true,
      order_index: 2,
    });

    expect(row.id).toBeDefined();
    await db.delete(rules).where(eq(rules.id, row.id));
  });
});

// ---------------------------------------------------------------------------
// proxies unique constraint
// ---------------------------------------------------------------------------

describe("proxies unique constraint on proxy_id", () => {
  it("rejects duplicate proxy_id", async () => {
    const proxyUuid = randomUUID();
    const secretHash = createHash("sha256").update("test-secret").digest("hex");

    await db.insert(proxies).values({
      tenant_id: tenantId,
      proxy_id: proxyUuid,
      name: "proxy-a",
      secret_hash: secretHash,
      secret_prefix: "cxp_test",
    });

    await expect(
      db.insert(proxies).values({
        tenant_id: tenantId,
        proxy_id: proxyUuid, // duplicate
        name: "proxy-b",
        secret_hash: secretHash,
        secret_prefix: "cxp_test",
      }),
    ).rejects.toSatisfy((err) => isConstraintViolation(err, UNIQUE_VIOLATION));

    await db.delete(proxies).where(eq(proxies.proxy_id, proxyUuid));
  });
});

// ---------------------------------------------------------------------------
// project_tokens unique constraint on token_hash
// ---------------------------------------------------------------------------

describe("project_tokens unique constraint on token_hash", () => {
  it("rejects duplicate token_hash", async () => {
    const hash = createHash("sha256").update(randomBytes(16)).digest("hex");

    await db.insert(project_tokens).values({
      project_id: projectId,
      tenant_id: tenantId,
      name: "token-dup-a",
      created_by_user_id: TEST_USER_ID,
      token_hash: hash,
      token_prefix: "aaa111",
    });

    await expect(
      db.insert(project_tokens).values({
        project_id: projectId,
        tenant_id: tenantId,
        name: "token-dup-b",
        created_by_user_id: TEST_USER_ID,
        token_hash: hash, // duplicate
        token_prefix: "bbb222",
      }),
    ).rejects.toSatisfy((err) => isConstraintViolation(err, UNIQUE_VIOLATION));

    // Clean up — delete by name since the second insert failed
    await db.delete(project_tokens).where(eq(project_tokens.token_hash, hash));
  });
});

// ---------------------------------------------------------------------------
// tenant_entitlements unique constraint on tenant_id
// ---------------------------------------------------------------------------

describe("tenant_entitlements unique constraint on tenant_id", () => {
  it("rejects a second entitlement row for the same tenant", async () => {
    await db.insert(tenant_entitlements).values({ tenant_id: tenantId });

    await expect(
      db.insert(tenant_entitlements).values({ tenant_id: tenantId }),
    ).rejects.toSatisfy((err) => isConstraintViolation(err, UNIQUE_VIOLATION));

    await db
      .delete(tenant_entitlements)
      .where(eq(tenant_entitlements.tenant_id, tenantId));
  });
});

// ---------------------------------------------------------------------------
// FK cascade: deleting tenant removes all child rows
// ---------------------------------------------------------------------------

describe("FK cascade on tenant delete", () => {
  it("deletes all child rows when tenant is deleted", async () => {
    const cascadeTenantId = randomUUID();

    const [ct] = await db
      .insert(tenants)
      .values({ id: cascadeTenantId, name: "cascade-test-tenant" })
      .returning();

    const [cp] = await db
      .insert(projects)
      .values({ tenant_id: ct.id, name: "cascade-project" })
      .returning();

    await db.insert(policies).values({
      tenant_id: ct.id,
      name: "cascade-policy",
      scope: "global",
      status: "active",
      enforcement_mode: "enforcing",
      priority: 100,
    });

    const rawToken = randomBytes(16).toString("hex");
    await db.insert(project_tokens).values({
      project_id: cp.id,
      tenant_id: ct.id,
      name: "cascade-token",
      created_by_user_id: TEST_USER_ID,
      token_hash: createHash("sha256").update(rawToken).digest("hex"),
      token_prefix: rawToken.slice(-6),
    });

    await db.insert(proxies).values({
      tenant_id: ct.id,
      proxy_id: randomUUID(),
      name: "cascade-proxy",
      secret_hash: createHash("sha256").update("cascade-secret").digest("hex"),
      secret_prefix: "cxp_casc",
    });

    // Delete the tenant — all child rows should cascade
    await db.delete(tenants).where(eq(tenants.id, ct.id));

    const remainingProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.tenant_id, ct.id));
    const remainingPolicies = await db
      .select()
      .from(policies)
      .where(eq(policies.tenant_id, ct.id));
    const remainingTokens = await db
      .select()
      .from(project_tokens)
      .where(eq(project_tokens.tenant_id, ct.id));
    const remainingProxies = await db
      .select()
      .from(proxies)
      .where(eq(proxies.tenant_id, ct.id));

    expect(remainingProjects).toHaveLength(0);
    expect(remainingPolicies).toHaveLength(0);
    expect(remainingTokens).toHaveLength(0);
    expect(remainingProxies).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// FK set null: deleting project_token nullifies events.project_token_id
// ---------------------------------------------------------------------------

describe("FK set null on project_token delete", () => {
  it("sets project_token_id to null on events when token is deleted", async () => {
    const rawToken = randomBytes(16).toString("hex");
    const [token] = await db
      .insert(project_tokens)
      .values({
        project_id: projectId,
        tenant_id: tenantId,
        name: "fk-null-test-token",
        created_by_user_id: TEST_USER_ID,
        token_hash: createHash("sha256").update(rawToken).digest("hex"),
        token_prefix: rawToken.slice(-6),
      })
      .returning();

    const [event] = await db
      .insert(events)
      .values({
        tenant_id: tenantId,
        project_id: projectId,
        project_token_id: token.id,
        proxy_id: randomUUID(),
        decision: "allow",
        source: "policy_engine",
        event_type: "proxy_request",
        raw_identity: {
          ecosystem: "npm",
          package: "lodash",
          version: "4.17.21",
          source: "schema_test",
        },
        requested_at: new Date(),
      })
      .returning();

    // Delete the token — event.project_token_id should become null
    await db.delete(project_tokens).where(eq(project_tokens.id, token.id));

    const [updatedEvent] = await db
      .select({ project_token_id: events.project_token_id })
      .from(events)
      .where(eq(events.id, event.id));

    expect(updatedEvent.project_token_id).toBeNull();

    // Cleanup
    await db.delete(events).where(eq(events.id, event.id));
  });
});
