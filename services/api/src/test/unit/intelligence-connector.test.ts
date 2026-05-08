import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/internal-service-jwt.js", () => ({
  issueInternalServiceRuntimeToken: vi.fn().mockResolvedValue({
    accessToken: "test-intelligence-token",
    expiresAt: new Date("2026-04-23T00:00:00Z"),
    refreshAfter: new Date("2026-04-23T00:00:00Z"),
  }),
}));

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
  },
}));

import { IntelligenceConnector } from "../../connectors/intelligence/index.js";
import { IntelligenceConnectorConfig } from "../../connectors/intelligence/config.js";
import { issueInternalServiceRuntimeToken } from "../../auth/internal-service-jwt.js";

describe("IntelligenceConnector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty result for unsupported ecosystems", async () => {
    const connector = new IntelligenceConnector(
      new IntelligenceConnectorConfig(),
    );

    await expect(
      connector.fetchSignals("golang", "example", "1.0.0"),
    ).resolves.toMatchObject({
      summary: {
        intelligence: {
          is_suspicious: false,
          recommended_action: "allow",
        },
      },
      findings: [],
    });
  });

  it("maps a suspicious intelligence response into a connector result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          is_suspicious: true,
          nearest_match: "react",
          match_quality: "strong",
          recommended_action: "block",
          llm_verdict: "High confidence typosquat candidate.",
          confidence: "high",
          latency_ms: 48,
          source: "vector_search",
          metadata: {
            similarity_score: 0.82,
            lexical_similarity_score: 0.9,
            candidate_source_rank: 1,
            candidate_score_final: 2314.97,
            candidate_trust: "high",
            adjacent_name_found_in_corpus: false,
            judge_cache_hit: true,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const connector = new IntelligenceConnector(
      new IntelligenceConnectorConfig(),
    );
    const result = await connector.fetchSignals("npm", "recat", "1.0.0", {
      tenantId: "tenant-1",
      projectId: "project-1",
    });

    expect(result).toMatchObject({
      summary: {
        intelligence: {
          is_suspicious: true,
          nearest_match: "react",
          recommended_action: "block",
          confidence: "high",
          semantic_score: 0.82,
          lexical_similarity_score: 0.9,
        },
      },
      findings: [
        expect.objectContaining({
          findingId: "typosquat_candidate",
          severity: "HIGH",
          title: "Possible typosquat of react",
        }),
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://intelligence:8001/check",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-intelligence-token",
        }),
      }),
    );
    expect(issueInternalServiceRuntimeToken).toHaveBeenCalledWith({
      service: "api",
      subject: "api:intelligence-connector",
      audience: "customs-intelligence-rpc",
      tenantId: "tenant-1",
      projectId: "project-1",
      claims: {
        token_type: "api_connector",
      },
    });
  });

  it("normalizes a suspicious result into snapshot fields", () => {
    const connector = new IntelligenceConnector(
      new IntelligenceConnectorConfig(),
    );

    const snapshot = connector.normalizeToSnapshot(
      {
        summary: {
          intelligence: {
            is_suspicious: true,
            nearest_match: "react",
            match_quality: "strong",
            recommended_action: "block",
            llm_verdict: "High confidence typosquat candidate.",
            confidence: "high",
            latency_ms: 48,
            source: "vector_search",
            semantic_score: 0.82,
            lexical_similarity_score: 0.9,
            candidate_source_rank: 1,
            candidate_score_final: 2314.97,
            candidate_trust: "high",
            adjacent_name_found_in_corpus: false,
            judge_cache_hit: true,
          },
        },
        findings: [],
      },
      {
        ecosystem: "npm",
        pkg: "recat",
        version: "1.0.0",
        isCacheHit: false,
        responseTimeMs: 12,
        cacheAgeHours: null,
      },
    );

    expect(snapshot).toMatchObject({
      connectorKey: "intelligence",
      entityId: "npm:recat:1.0.0",
      fields: {
        is_suspicious: true,
        nearest_match: "react",
        recommended_action: "block",
        confidence: "high",
      },
      meta: {
        status: "ok",
        responseTimeMs: 12,
      },
    });
  });

  it("builds a useful presentation for suspicious results", () => {
    const connector = new IntelligenceConnector(
      new IntelligenceConnectorConfig(),
    );

    const presentation = connector.buildPresentation(
      {
        summary: {
          intelligence: {
            is_suspicious: true,
            nearest_match: "react",
            match_quality: "strong",
            recommended_action: "block",
            llm_verdict: "High confidence typosquat candidate.",
            confidence: "high",
            latency_ms: 48,
            source: "vector_search",
            semantic_score: 0.82,
            lexical_similarity_score: 0.9,
            candidate_source_rank: 1,
            candidate_score_final: 2314.97,
            candidate_trust: "high",
            adjacent_name_found_in_corpus: false,
            judge_cache_hit: true,
          },
        },
        findings: [
          {
            findingId: "typosquat_candidate",
            severity: "HIGH",
            title: "Possible typosquat of react",
            publishedAt: null,
            attributes: {},
          },
        ],
      },
      {
        connectorKey: "intelligence",
        entityType: "artifact",
        entityId: "npm:recat:1.0.0",
        fields: {},
        meta: {
          status: "ok",
          responseTimeMs: 20,
          cacheAgeHours: null,
          isCacheHit: false,
        },
        observedAt: new Date("2026-04-23T00:00:00Z").toISOString(),
      },
    );

    expect(presentation).toMatchObject({
      summary: {
        headline: "Possible typosquat of react",
        disposition: "blocked",
        badges: expect.arrayContaining([
          expect.objectContaining({ label: "block" }),
          expect.objectContaining({ label: "high confidence" }),
          expect.objectContaining({ label: "strong match" }),
        ]),
        keyFacts: expect.arrayContaining([
          { label: "Nearest match", value: "react" },
          { label: "Candidate rank", value: "1" },
        ]),
      },
    });
  });
});
