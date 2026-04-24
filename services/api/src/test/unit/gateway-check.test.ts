/**
 * Unit tests for handleCheck — all DB calls are mocked.
 *
 * DB call ordering inside handleCheck (determines mockReturnValueOnce sequence):
 *   1. db.select → proxy lookup          (from proxies)
 *   2. db.select → token lookup          (from project_tokens)
 *   3. db.select → tenant_entitlements
 *   4. db.select → policies              (loadEffectivePolicy — always runs)
 *   5. db.select → rules                 (loadEffectivePolicy — only when policyIds.length > 0)
 *   6. db.select → policy_assignments    (loadEffectivePolicy — only when policyIds.length > 0)
 *
 * When connectors=[] (default in tests) no connector cache/snapshot queries run.
 * Fire-and-forget calls use db.update / db.insert and don't need sequencing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    requestBodyLimitBytes: 1048576,
    corsOrigins: ["http://localhost:3001"],
    authUrl: "http://api.local",
    authProxyEnabled: false,
    gotrueUrl: "http://gotrue.local",
    gotrueServiceRoleKey: "service-role-key",
    environment: "test",
    logLevel: "info",
    databaseUrl: "postgresql://localhost/customs-unit-fake",
    proxyJwtSecret: "test-secret",
  },
}));

vi.mock("../../db/index.js");

import { db } from "../../db/index.js";
import { handleCheck } from "../../connect/gateway.js";
import { PACKAGE_SCOPE_CACHE_VERSION } from "../../connectors/cache.js";
import {
  q,
  fakeToken,
  fakeEntitlement,
  fakeV2Policy,
  fakeV2Rule,
  TEST_TOKEN,
  TEST_TENANT_ID,
  TEST_PROJECT_ID,
} from "../helpers/fakes.js";
import type { VerifiedProxyContext } from "../../connect/proxy-context.js";
import type { PackageIntelligenceConnector } from "../../connectors/types.js";

// ---------------------------------------------------------------------------
// Setup: reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(db.select).mockReset();
  vi.mocked(db.select).mockReturnValue(q([]) as any);
  vi.mocked(db.update).mockReturnValue(q(undefined) as any);
  vi.mocked(db.insert).mockReturnValue(q(undefined) as any);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set up the standard "happy path" DB sequence for handleCheck.
 *
 * Sequence:
 *   1. proxy
 *   2. token
 *   3. entitlement
 *   4. policies  (loadEffectivePolicy)
 *   5. rules     (loadEffectivePolicy, only when policies non-empty)
 *   6. assignments (loadEffectivePolicy, only when policies non-empty)
 */
function mockHappyPath(
  opts: {
    policies?: ReturnType<typeof fakeV2Policy>[];
    rules?: ReturnType<typeof fakeV2Rule>[];
    assignments?: unknown[];
    entitlement?: ReturnType<typeof fakeEntitlement> | null;
  } = {},
) {
  const {
    policies = [fakeV2Policy()],
    rules = [fakeV2Rule()], // default rule never matches → package allowed
    assignments = [],
    entitlement = fakeEntitlement(),
  } = opts;

  // 1. token lookup
  vi.mocked(db.select).mockReturnValueOnce(q([fakeToken()]) as any);
  // 2. entitlement
  vi.mocked(db.select).mockReturnValueOnce(
    q(entitlement ? [entitlement] : []) as any,
  );
  // 3. policies
  vi.mocked(db.select).mockReturnValueOnce(q(policies) as any);
  if (policies.length > 0) {
    // 4. rules
    vi.mocked(db.select).mockReturnValueOnce(q(rules) as any);
    // 5. policy_assignments
    vi.mocked(db.select).mockReturnValueOnce(q(assignments) as any);
  }
}

function makeProxy(
  overrides: Partial<VerifiedProxyContext> = {},
): VerifiedProxyContext {
  return {
    proxyId: "test-proxy-id",
    tenantId: TEST_TENANT_ID,
    proxyIp: "10.0.0.1",
    ...overrides,
  };
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    project_token: TEST_TOKEN,
    ecosystem: "npm",
    package: "lodash",
    version: "4.17.15",
    trace_id: "trace-1",
    request_id: "req-1",
    span_id: "span-1",
    client_ip: "1.2.3.4",
    proxy_ip: "10.0.0.1",
    contributor_context: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Token validation
// ---------------------------------------------------------------------------

describe("token validation", () => {
  it("blocks when token is not found", async () => {
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any);
    const result = await handleCheck(makeProxy(), makeReq());
    expect(result.reason).toBe("invalid_token");
  });

  it("blocks when token is revoked", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([fakeToken({ revoked_at: new Date() })]) as any,
    );
    const result = await handleCheck(makeProxy(), makeReq());
    expect(result.reason).toBe("invalid_token");
  });

  it("blocks when token belongs to a different tenant", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([fakeToken({ tenant_id: "tenant-B" })]) as any,
    );
    const result = await handleCheck(
      makeProxy({ tenantId: "tenant-A" }),
      makeReq(),
    );
    expect(result.reason).toBe("invalid_token");
  });

  it("blocks when token is expired", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([fakeToken({ expires_at: new Date(Date.now() - 60_000) })]) as any,
    );
    const result = await handleCheck(makeProxy(), makeReq());
    expect(result.reason).toBe("invalid_token");
  });
});

// ---------------------------------------------------------------------------
// Policy decisions
// ---------------------------------------------------------------------------

describe("policy decisions", () => {
  it("allows when policy has rules that do not match", async () => {
    // Default fakeV2Rule condition (critical_count > 1000) never matches
    // because field is absent when no connectors run
    mockHappyPath();
    const result = await handleCheck(makeProxy(), makeReq());
    expect(result.decision).toBe(1); // DECISION_ALLOW
    expect(result.reason).toBe("allowed");
  });

  it("blocks when no active policy is configured", async () => {
    // Proxy + token OK, but no policies → allRules=[] → no_policy
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeToken()]) as any)
      .mockReturnValueOnce(q([]) as any)
      .mockReturnValueOnce(q([]) as any);
    // No rules/assignments queries — loadEffectivePolicy returns early when policyIds is empty
    const result = await handleCheck(makeProxy(), makeReq());
    expect(result.reason).toBe("no_policy");
    expect(result.decision).toBe(2); // DECISION_BLOCK
  });

  it("blocks when entitlement restricts the ecosystem", async () => {
    // Ecosystem check fires before policy loading — only proxy+token+entitlement needed
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeToken()]) as any)
      .mockReturnValueOnce(
        q([fakeEntitlement({ allowed_ecosystems: ["pypi"] })]) as any,
      );
    const result = await handleCheck(
      makeProxy(),
      makeReq({ ecosystem: "npm" }),
    );
    expect(result.decision).toBe(2);
    expect(result.reason).toBe("ecosystem_not_permitted");
  });

  it("blocks when a matching enforcing violation rule fires", async () => {
    mockHappyPath({
      rules: [
        fakeV2Rule({
          condition: {
            field: "asset.package",
            operator: "eq",
            value: "lodash",
          },
          action: {
            type: "violation",
            enforcement_mode: "enforcing",
            severity: "high",
            code: "PKG_BLOCKED",
          },
        }),
      ],
    });
    const result = await handleCheck(makeProxy(), makeReq());
    expect(result.decision).toBe(2); // DECISION_BLOCK
    expect(result.reason).toBe("PKG_BLOCKED");
  });

  it("allows when a matching rule is in advisory enforcement mode", async () => {
    mockHappyPath({
      rules: [
        fakeV2Rule({
          condition: {
            field: "asset.package",
            operator: "eq",
            value: "lodash",
          },
          action: {
            type: "violation",
            enforcement_mode: "advisory",
            severity: "medium",
            code: "ADVISORY_HIT",
          },
        }),
      ],
    });
    const result = await handleCheck(makeProxy(), makeReq());
    expect(result.decision).toBe(1); // DECISION_ALLOW
    expect(result.reason).toBe("advisory_only");
  });

  it("returns cache_ttl_seconds from entitlement on allow", async () => {
    mockHappyPath({ entitlement: fakeEntitlement({ cache_ttl_seconds: 120 }) });
    const result = await handleCheck(makeProxy(), makeReq());
    expect(result.decision).toBe(1);
    expect(result.cache_ttl_seconds).toBe(120);
  });

  it("returns zero cache_ttl_seconds on block (no caching blocks)", async () => {
    mockHappyPath({
      rules: [
        fakeV2Rule({
          condition: {
            field: "asset.package",
            operator: "eq",
            value: "lodash",
          },
          action: {
            type: "violation",
            enforcement_mode: "enforcing",
            severity: "high",
            code: "BLOCK_TEST",
          },
        }),
      ],
    });
    const result = await handleCheck(makeProxy(), makeReq());
    expect(result.decision).toBe(2);
    expect(result.cache_ttl_seconds).toBe(0);
  });

  it("returns tenant_id and project_id from the token row", async () => {
    mockHappyPath();
    const result = await handleCheck(makeProxy(), makeReq());
    expect(result.tenant_id).toBe(TEST_TENANT_ID);
    expect(result.project_id).toBe(TEST_PROJECT_ID);
  });

  it("surfaces contributor missing facts as unavailable instead of a clean score", async () => {
    const contributorConnector: PackageIntelligenceConnector = {
      id: "contributor",
      config: {
        cacheTtlSeconds: 3600,
        responseTimeoutMs: 1000,
        backgroundTimeoutMs: 1000,
        baseUrl: "",
      },
      async fetchSignals() {
        throw new Error("contributor_facts_unavailable");
      },
      async initialize() {},
      async shutdown() {},
      getFieldCatalog() {
        return [];
      },
      normalizeToSnapshot(_result, context, failureStatus) {
        return {
          connectorKey: "contributor",
          entityType: "artifact",
          entityId: `${context.ecosystem}:${context.pkg}:${context.version}`,
          fields: failureStatus ? {} : { contributor_risk_score: 0 },
          meta: {
            status: failureStatus ?? "ok",
            responseTimeMs: context.responseTimeMs,
            cacheAgeHours: context.cacheAgeHours,
            isCacheHit: context.isCacheHit,
          },
          observedAt: new Date().toISOString(),
        };
      },
      getFindingSchema() {
        return [];
      },
    };

    mockHappyPath({
      rules: [
        fakeV2Rule({
          condition: {
            field: "source.contributor._meta.status",
            operator: "eq",
            value: "unavailable",
          },
          action: {
            type: "violation",
            enforcement_mode: "enforcing",
            severity: "medium",
            code: "CONTRIBUTOR_DATA_UNAVAILABLE",
          },
        }),
      ],
    });
    vi.mocked(db.select)
      .mockReturnValueOnce(q([]) as any)
      .mockReturnValueOnce(q([]) as any);

    const result = await handleCheck(makeProxy(), makeReq(), [
      contributorConnector,
    ]);

    expect(result.decision).toBe(2);
    expect(result.reason).toBe("CONTRIBUTOR_DATA_UNAVAILABLE");
  });

  it("surfaces connector timeouts as background_pending for policy evaluation", async () => {
    const normalizeToSnapshot = vi.fn((_result, context, failureStatus) => ({
      connectorKey: "timeout",
      entityType: "artifact",
      entityId: `${context.ecosystem}:${context.pkg}:${context.version}`,
      fields: {},
      meta: {
        status: failureStatus ?? "ok",
        responseTimeMs: context.responseTimeMs,
        cacheAgeHours: context.cacheAgeHours,
        isCacheHit: context.isCacheHit,
      },
      observedAt: new Date().toISOString(),
    }));
    const timeoutConnector: PackageIntelligenceConnector = {
      id: "timeout",
      config: {
        cacheTtlSeconds: 3600,
        responseTimeoutMs: 1,
        backgroundTimeoutMs: 1000,
        baseUrl: "",
      },
      async fetchSignals() {
        return await new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                summary: {
                  vulnerability: {
                    maxSeverity: "NONE",
                    findingCount: 0,
                    fixAvailable: false,
                    bestFixVersion: null,
                  },
                },
                findings: [],
              }),
            10,
          ),
        );
      },
      async initialize() {},
      async shutdown() {},
      getFieldCatalog() {
        return [];
      },
      normalizeToSnapshot,
      getFindingSchema() {
        return [];
      },
    };

    mockHappyPath({
      rules: [
        fakeV2Rule({
          condition: {
            field: "source.timeout._meta.status",
            operator: "eq",
            value: "background_pending",
          },
          action: {
            type: "violation",
            enforcement_mode: "enforcing",
            severity: "medium",
            code: "CONNECTOR_TIMEOUT",
          },
        }),
      ],
    });
    vi.mocked(db.select)
      .mockReturnValueOnce(q([]) as any)
      .mockReturnValueOnce(
        q([
          {
            connector_key: "timeout",
            entity_type: "artifact",
            entity_id: "npm:lodash:4.17.15",
            fields: {},
            meta: {
              status: "background_pending",
              responseTimeMs: 1,
              cacheAgeHours: null,
              isCacheHit: false,
              errorCode: "response_timeout",
            },
            observed_at: new Date("2026-04-01T00:00:00Z"),
          },
        ]) as any,
      );

    const result = await handleCheck(makeProxy(), makeReq(), [
      timeoutConnector,
    ]);

    expect(result.decision).toBe(2);
    expect(result.reason).toBe("CONNECTOR_TIMEOUT");

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(normalizeToSnapshot).toHaveBeenCalledTimes(2);
    expect(normalizeToSnapshot).toHaveBeenNthCalledWith(
      1,
      null,
      expect.objectContaining({
        ecosystem: "npm",
        pkg: "lodash",
        version: "4.17.15",
        isCacheHit: false,
      }),
      "background_pending",
      "response_timeout",
    );
    expect(normalizeToSnapshot).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        summary: expect.any(Object),
        findings: [],
      }),
      expect.objectContaining({
        ecosystem: "npm",
        pkg: "lodash",
        version: "4.17.15",
        isCacheHit: false,
      }),
    );
  });

  it("allows metadata requests (no version) without loading policy", async () => {
    // Metadata request shortcut fires after entitlement check but before policy loading
    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeToken()]) as any)
      .mockReturnValueOnce(q([fakeEntitlement()]) as any);
    const result = await handleCheck(makeProxy(), makeReq({ version: "" }));
    expect(result.decision).toBe(1);
    expect(result.reason).toBe("metadata_request");
  });

  it("warms package-scoped intelligence cache on metadata requests", async () => {
    const intelligenceConnector: PackageIntelligenceConnector = {
      id: "intelligence",
      config: {
        cacheTtlSeconds: 3600,
        responseTimeoutMs: 1000,
        backgroundTimeoutMs: 1000,
        baseUrl: "",
      },
      fetchSignals: vi.fn().mockResolvedValue({
        summary: {
          intelligence: {
            is_suspicious: false,
            nearest_match: null,
            match_quality: "weak",
            recommended_action: "allow",
            llm_verdict: null,
            confidence: "low",
            latency_ms: 5,
            source: "vector_search",
            semantic_score: null,
            lexical_similarity_score: null,
            candidate_source_rank: null,
            candidate_score_final: null,
            candidate_trust: null,
            adjacent_name_found_in_corpus: false,
            judge_cache_hit: null,
          },
        },
        findings: [],
      }),
      async initialize() {},
      async shutdown() {},
      getFieldCatalog() {
        return [];
      },
      normalizeToSnapshot() {
        throw new Error("not used");
      },
      getFindingSchema() {
        return [];
      },
    };

    vi.mocked(db.select)
      .mockReturnValueOnce(q([fakeToken()]) as any)
      .mockReturnValueOnce(q([fakeEntitlement()]) as any)
      .mockReturnValueOnce(q([]) as any);

    const result = await handleCheck(
      makeProxy(),
      makeReq({ version: "" }),
      [intelligenceConnector],
    );

    expect(result.decision).toBe(1);
    expect(result.reason).toBe("metadata_request");

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(intelligenceConnector.fetchSignals).toHaveBeenCalledWith(
      "npm",
      "lodash",
      PACKAGE_SCOPE_CACHE_VERSION,
      {
        tenantId: "00000000-0000-0000-0000-000000000001",
        projectId: "00000000-0000-0000-0000-000000000002",
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Ping path — empty token triggers invalid_token, which is the success signal
// ---------------------------------------------------------------------------

describe("ping path", () => {
  it("returns invalid_token when project_token is empty (ping check)", async () => {
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any);
    const result = await handleCheck(
      makeProxy(),
      makeReq({ project_token: "" }),
    );
    expect(result.reason).toBe("invalid_token");
  });
});
