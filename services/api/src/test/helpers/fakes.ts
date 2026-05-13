/**
 * Test helpers: thenable Drizzle query-chain mock and fake row factories.
 *
 * Usage in a unit test:
 *
 *   vi.mock('../../db/index.js');
 *   import { db } from '../../db/index.js';
 *   import { q, fakeProxy, fakeToken } from '../helpers/fakes.js';
 *
 *   vi.mocked(db.select).mockReturnValueOnce(q([fakeProxy()]));
 */

import { vi } from "vitest";
import { createHash } from "node:crypto";
import { VALID_TO_INFINITY_ISO } from "@customs/shared-constants";

// ---------------------------------------------------------------------------
// Well-known test credentials — hashes match the values used in tests.
// ---------------------------------------------------------------------------
export const TEST_PROXY_ID = "test-proxy-id";
export const TEST_PROXY_SECRET = "cxp_testsecret1234";
export const TEST_PROXY_SECRET_HASH = createHash("sha256")
  .update(TEST_PROXY_SECRET)
  .digest("hex");

export const TEST_TOKEN = "cxp_token_testvalue";
export const TEST_TOKEN_HASH = createHash("sha256")
  .update(TEST_TOKEN)
  .digest("hex");

export const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000001";
export const TEST_PROJECT_ID = "00000000-0000-0000-0000-000000000002";
export const TEST_POLICY_ID = "00000000-0000-0000-0000-000000000003";
export const TEST_RULE_ID = "00000000-0000-0000-0000-000000000041";
export const TEST_POLICY_KEY = "00000000-0000-0000-0000-000000000103";
export const TEST_RULE_KEY = "00000000-0000-0000-0000-000000000141";
export const TEST_USER_ID = "00000000-0000-0000-0000-000000000099";

// ---------------------------------------------------------------------------
// q<T>(rows) — returns a Drizzle-compatible chainable thenable that resolves
// with `rows`. All builder methods (from, where, limit, set, values …)
// return the same object so that chained calls work without configuration.
// ---------------------------------------------------------------------------
export function q<T>(rows: T): any {
  const self: any = {
    then(onFulfilled: any, onRejected: any) {
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    },
    catch(onRejected: any) {
      return Promise.resolve(rows).catch(onRejected);
    },
    finally(onFinally: any) {
      return Promise.resolve(rows).finally(onFinally);
    },
  };

  for (const m of [
    "from",
    "where",
    "limit",
    "set",
    "values",
    "returning",
    "orderBy",
    "offset",
    "groupBy",
    "having",
    "leftJoin",
    "innerJoin",
    "rightJoin",
    "fullJoin",
    "onConflictDoUpdate",
    "onConflictDoNothing",
  ]) {
    self[m] = vi.fn().mockReturnValue(self);
  }

  return self;
}

// ---------------------------------------------------------------------------
// Fake row factories — return minimal valid row objects with sensible defaults.
// All fields accept partial overrides via the options parameter.
// ---------------------------------------------------------------------------

export function fakeProxy(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000010",
    tenant_id: TEST_TENANT_ID,
    proxy_id: TEST_PROXY_ID,
    name: "test-proxy",
    status: "active",
    secret_hash: TEST_PROXY_SECRET_HASH,
    secret_prev_hash: null,
    secret_prev_expires_at: null,
    secret_prefix: "cxp_test",
    disabled_at: null,
    secret_rotated_at: null,
    last_seen_at: null,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function fakeToken(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000020",
    project_id: TEST_PROJECT_ID,
    tenant_id: TEST_TENANT_ID,
    name: "test-token",
    owner_user_id: TEST_USER_ID,
    created_by_user_id: TEST_USER_ID,
    token_hash: TEST_TOKEN_HASH,
    token_prefix: "cxp_to",
    expires_at: null,
    revoked_at: null,
    revoked_by_user_id: null,
    created_at: new Date("2026-01-01T00:00:00Z"),
    last_used_at: null,
    ...overrides,
  };
}

export function fakePolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_POLICY_ID,
    policy_key: TEST_POLICY_KEY,
    tenant_id: TEST_TENANT_ID,
    project_id: null,
    parent_policy_id: null,
    serve_mode: "SERVE_MODE_REDIRECT",
    cve_threshold: "HIGH",
    min_age_days: 1,
    block_new_packages: true,
    allowed_ecosystems: null,
    enabled: true,
    cache_ttl_seconds: 300,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function fakeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000040",
    policy_id: TEST_POLICY_ID,
    ecosystem: "npm",
    package: "lodash",
    version_range: null,
    action: "allow",
    reason: null,
    enabled: true,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function fakeTenant(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_TENANT_ID,
    name: "Test Organisation",
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function fakeMembership(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000060",
    tenant_id: TEST_TENANT_ID,
    tenant_name: "Test Organisation",
    user_id: TEST_USER_ID,
    role: "owner",
    created_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function fakeEntitlement(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000050",
    tenant_id: TEST_TENANT_ID,
    allowed_ecosystems: null, // null = unrestricted
    serve_mode: "SERVE_MODE_REDIRECT",
    cache_ttl_seconds: 300,
    mcp_enabled: false,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// V2 policy / rule factories — match the new `policies` and `rules` tables.
// ---------------------------------------------------------------------------

export function fakeV2Policy(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_POLICY_ID,
    tenant_id: TEST_TENANT_ID,
    project_id: null,
    name: "Test Policy",
    description: null,
    category: null,
    scope: "global",
    status: "active",
    enforcement_mode: "enforcing",
    priority: 100,
    version: 1,
    effective_from: new Date("2026-01-01T00:00:00Z"),
    effective_to: new Date(VALID_TO_INFINITY_ISO),
    superseded_by_id: null,
    created_by_user_id: TEST_USER_ID,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

/**
 * Default condition (`source.osv.critical_count > 1000`) never matches in tests
 * because the field is absent (no connector snapshots) — so the package is allowed.
 * Override `condition` and `action` to test specific rule behaviour.
 */
export function fakeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_PROJECT_ID,
    tenant_id: TEST_TENANT_ID,
    name: "Test Project",
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export const TEST_VIOLATION_ID = "00000000-0000-0000-0000-000000000070";

export function fakeViolation(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_VIOLATION_ID,
    tenant_id: TEST_TENANT_ID,
    project_id: TEST_PROJECT_ID,
    project_token_id: null,
    proxy_id: null,
    rule_id: TEST_RULE_ID,
    policy_id: TEST_POLICY_ID,
    severity: "HIGH",
    status: "open",
    status_note: null,
    blocked: true,
    code: "TEST_RULE",
    message: "Test violation",
    evaluated_at: new Date("2026-01-01T00:00:00Z"),
    created_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function fakeV2Rule(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_RULE_ID,
    rule_key: TEST_RULE_KEY,
    policy_id: TEST_POLICY_ID,
    tenant_id: TEST_TENANT_ID,
    name: "Test Rule",
    description: null,
    target_entity: "artifact",
    condition: {
      field: "source.osv.critical_count",
      operator: "gt",
      value: 1000,
    },
    action: {
      type: "violation",
      severity: "high",
      code: "TEST_RULE",
      enforcement_mode: "enforcing",
    },
    enabled: true,
    order_index: 0,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}
