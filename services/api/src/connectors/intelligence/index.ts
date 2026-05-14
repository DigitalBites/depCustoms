import { z } from "zod";
import { issueInternalServiceRuntimeToken } from "../../auth/internal-service-jwt.js";
import type {
  ConnectorArtifactEvent,
  ConnectorEventOutcome,
  ConnectorField,
  ConnectorFindingField,
  ConnectorPresentation,
  ConnectorResult,
  ConnectorSnapshot,
  ConnectorSnapshotMeta,
  ConnectorUiBadge,
  ConnectorUiFact,
  ConnectorUiSummary,
  EntityContext,
  PackageIntelligenceConnector,
  VulnSeverity,
} from "../types.js";
import {
  buildDefaultConnectorPresentation,
  buildStatusBadges,
  buildStatusFacts,
} from "../presentation.js";
import type { IntelligenceConnectorConfig } from "./config.js";
import { log } from "../../logger.js";

const SUPPORTED_ECOSYSTEMS = new Set(["npm"]);
const CONNECTOR_ID = "intelligence";
const CHECK_PATH = "/check";
const INTELLIGENCE_AUDIENCE = "customs-intelligence-rpc";

const intelligenceCheckMetadataSchema = z.object({
  similarity_score: z.number().nullable(),
  lexical_similarity_score: z.number().nullable(),
  candidate_source_rank: z.number().int().nullable(),
  candidate_score_final: z.number().nullable(),
  candidate_trust: z.enum(["low", "medium", "high"]).nullable(),
  adjacent_name_found_in_corpus: z.boolean(),
  stage_timings_ms: z.record(z.string(), z.number().int()).nullable().optional(),
  judge_cache_hit: z.boolean().nullable().optional(),
});

const intelligenceCheckResponseSchema = z.object({
  is_suspicious: z.boolean(),
  nearest_match: z.string().nullable(),
  match_quality: z.enum(["weak", "ambiguous", "strong"]),
  recommended_action: z.enum(["allow", "review", "block"]),
  llm_verdict: z.string().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  latency_ms: z.number().int(),
  source: z.enum(["stub", "vector_search"]),
  metadata: intelligenceCheckMetadataSchema,
});

type IntelligenceCheckResponse = z.infer<typeof intelligenceCheckResponseSchema>;

type IntelligenceSummary = {
  is_suspicious: boolean;
  nearest_match: string | null;
  match_quality: "weak" | "ambiguous" | "strong";
  recommended_action: "allow" | "review" | "block";
  llm_verdict: string | null;
  confidence: "low" | "medium" | "high";
  latency_ms: number;
  source: "stub" | "vector_search";
  semantic_score: number | null;
  lexical_similarity_score: number | null;
  candidate_source_rank: number | null;
  candidate_score_final: number | null;
  candidate_trust: "low" | "medium" | "high" | null;
  adjacent_name_found_in_corpus: boolean;
  judge_cache_hit: boolean | null;
};

type IntelligenceResult = ConnectorResult & {
  summary?: ConnectorResult["summary"] & {
    intelligence?: IntelligenceSummary;
  };
};

function emptyResult(): IntelligenceResult {
  return {
    summary: {
      intelligence: {
        is_suspicious: false,
        nearest_match: null,
        match_quality: "weak",
        recommended_action: "allow",
        llm_verdict: null,
        confidence: "low",
        latency_ms: 0,
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
  };
}

function severityFromVerdict(
  recommendedAction: "allow" | "review" | "block",
  matchQuality: "weak" | "ambiguous" | "strong",
): VulnSeverity {
  if (recommendedAction === "block") {
    return matchQuality === "strong" ? "HIGH" : "MEDIUM";
  }
  if (recommendedAction === "review") {
    return "MEDIUM";
  }
  return "LOW";
}

function dispositionTone(
  value: "allow" | "review" | "block" | "low" | "medium" | "high" | "weak" | "ambiguous" | "strong",
): ConnectorUiBadge["tone"] {
  switch (value) {
    case "block":
    case "high":
    case "strong":
      return "bad";
    case "review":
    case "medium":
    case "ambiguous":
      return "warn";
    default:
      return "good";
  }
}

function mapResponseToResult(
  ecosystem: string,
  pkg: string,
  response: IntelligenceCheckResponse,
): IntelligenceResult {
  const summary: IntelligenceSummary = {
    is_suspicious: response.is_suspicious,
    nearest_match: response.nearest_match,
    match_quality: response.match_quality,
    recommended_action: response.recommended_action,
    llm_verdict: response.llm_verdict,
    confidence: response.confidence,
    latency_ms: response.latency_ms,
    source: response.source,
    semantic_score: response.metadata.similarity_score,
    lexical_similarity_score: response.metadata.lexical_similarity_score,
    candidate_source_rank: response.metadata.candidate_source_rank,
    candidate_score_final: response.metadata.candidate_score_final,
    candidate_trust: response.metadata.candidate_trust,
    adjacent_name_found_in_corpus:
      response.metadata.adjacent_name_found_in_corpus,
    judge_cache_hit: response.metadata.judge_cache_hit ?? null,
  };

  if (!response.is_suspicious) {
    return {
      summary: {
        intelligence: summary,
      },
      findings: [],
    };
  }

  return {
    summary: {
      intelligence: summary,
    },
    findings: [
      {
        findingId: `${ecosystem}:${pkg}:typosquat_candidate`,
        severity: severityFromVerdict(
          response.recommended_action,
          response.match_quality,
        ),
        title: response.nearest_match
          ? `Possible typosquat of ${response.nearest_match}`
          : `Possible typosquat package: ${pkg}`,
        publishedAt: null,
        attributes: {
          ecosystem,
          package: pkg,
          ...summary,
        },
      },
    ],
  };
}

function parseResultSummary(result: ConnectorResult | null): IntelligenceSummary | null {
  const intelligence = (result?.summary as IntelligenceResult["summary"] | undefined)
    ?.intelligence;
  return intelligence ?? null;
}

function buildRequestUrl(baseUrl: string): string {
  return new URL(CHECK_PATH, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

export class IntelligenceConnector implements PackageIntelligenceConnector {
  readonly id = CONNECTOR_ID;
  readonly config: IntelligenceConnectorConfig;
  readonly supportedEcosystems = ["npm"] as const;
  readonly subscribedEvents = [
    { kind: "package_metadata", executionMode: "async_preferred" },
    { kind: "artifact_request", executionMode: "async_preferred" },
  ] as const;

  constructor(config: IntelligenceConnectorConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {}

  async shutdown(): Promise<void> {}

  supportsEvent(event: ConnectorArtifactEvent): boolean {
    return SUPPORTED_ECOSYSTEMS.has(event.ecosystem.toLowerCase());
  }

  async handleEvent(event: ConnectorArtifactEvent): Promise<ConnectorEventOutcome> {
    if (!this.supportsEvent(event)) {
      return null;
    }
    return this.fetchPackageSignals(
      event.ecosystem,
      event.packageName,
      event.version,
      event.context,
    );
  }

  private async fetchPackageSignals(
    ecosystem: string,
    pkg: string,
    version: string | null,
    requestContext?: { tenantId?: string; projectId?: string },
  ): Promise<ConnectorResult> {
    const normalizedEcosystem = ecosystem.toLowerCase();
    if (!SUPPORTED_ECOSYSTEMS.has(normalizedEcosystem)) {
      log.debug("connector_ecosystem_unsupported", {
        component: "policy_connectors",
        connector: this.id,
        ecosystem,
        package: pkg,
        version,
      });
      return emptyResult();
    }

    log.debug("connector_fetch_start", {
      component: "policy_connectors",
      connector: this.id,
      ecosystem,
      package: pkg,
      version,
    });

    const token = await issueInternalServiceRuntimeToken({
      service: "api",
      subject: "api:intelligence-connector",
      audience: INTELLIGENCE_AUDIENCE,
      ...(requestContext?.tenantId ? { tenantId: requestContext.tenantId } : {}),
      ...(requestContext?.projectId ? { projectId: requestContext.projectId } : {}),
      claims: {
        token_type: "api_connector",
      },
    });

    const response = await fetch(buildRequestUrl(this.config.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token.accessToken}`,
      },
      body: JSON.stringify({
        ecosystem: normalizedEcosystem,
        package: pkg,
      }),
      signal: AbortSignal.timeout(this.config.backgroundTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`intelligence_http_${response.status}`);
    }

    const parsed = intelligenceCheckResponseSchema.parse(await response.json());
    return mapResponseToResult(normalizedEcosystem, pkg, parsed);
  }

  normalizeToSnapshot(
    result: ConnectorResult | null,
    context: EntityContext,
    failureStatus?: ConnectorSnapshotMeta["status"],
    errorCode?: string,
  ): ConnectorSnapshot {
    const meta: ConnectorSnapshotMeta = {
      status: failureStatus ?? (context.isCacheHit ? "cache_hit" : "ok"),
      responseTimeMs: context.responseTimeMs,
      cacheAgeHours: context.cacheAgeHours,
      isCacheHit: context.isCacheHit,
      ...(errorCode ? { errorCode } : {}),
    };

    if (result === null) {
      return {
        connectorKey: this.id,
        entityType: "artifact",
        packageId: context.packageId,
        packageVersionId: context.packageVersionId,
        ecosystem: context.ecosystem,
        packageName: context.pkg,
        version: context.version,
        displayName: context.displayName,
        fields: {},
        meta,
        observedAt: new Date().toISOString(),
      };
    }

    const summary = parseResultSummary(result);
    return {
      connectorKey: this.id,
      entityType: "artifact",
      packageId: context.packageId,
      packageVersionId: context.packageVersionId,
      ecosystem: context.ecosystem,
      packageName: context.pkg,
      version: context.version,
      displayName: context.displayName,
      fields: {
        is_suspicious: summary?.is_suspicious ?? false,
        nearest_match: summary?.nearest_match ?? null,
        match_quality: summary?.match_quality ?? "weak",
        recommended_action: summary?.recommended_action ?? "allow",
        confidence: summary?.confidence ?? "low",
        llm_verdict: summary?.llm_verdict ?? null,
        source: summary?.source ?? "vector_search",
        latency_ms: summary?.latency_ms ?? 0,
        semantic_score: summary?.semantic_score ?? null,
        lexical_similarity_score: summary?.lexical_similarity_score ?? null,
        candidate_source_rank: summary?.candidate_source_rank ?? null,
        candidate_score_final: summary?.candidate_score_final ?? null,
        candidate_trust: summary?.candidate_trust ?? null,
        adjacent_name_found_in_corpus:
          summary?.adjacent_name_found_in_corpus ?? false,
        judge_cache_hit: summary?.judge_cache_hit ?? null,
      },
      meta,
      observedAt: new Date().toISOString(),
    };
  }

  buildPresentation(
    result: ConnectorResult | null,
    snapshot: ConnectorSnapshot,
  ): ConnectorPresentation {
    return buildDefaultConnectorPresentation(
      result,
      snapshot,
      this.getFindingSchema(),
      {
        connectorLabel: "Intelligence",
        buildSummary: (
          currentResult: ConnectorResult | null,
          currentSnapshot: ConnectorSnapshot,
        ): ConnectorUiSummary => {
          if (
            currentSnapshot.meta.status !== "ok" &&
            currentSnapshot.meta.status !== "cache_hit"
          ) {
            return {
              status: currentSnapshot.meta.status,
              headline: `Intelligence: ${currentSnapshot.meta.status.replaceAll("_", " ")}`,
              disposition: "unavailable",
              badges: buildStatusBadges(currentSnapshot),
              keyFacts: buildStatusFacts(currentSnapshot),
            };
          }

          const summary = parseResultSummary(currentResult);
          const badges: ConnectorUiBadge[] = [
            ...buildStatusBadges(currentSnapshot),
            {
              label: summary?.recommended_action ?? "allow",
              tone: dispositionTone(summary?.recommended_action ?? "allow"),
            },
            {
              label: `${summary?.confidence ?? "low"} confidence`,
              tone: dispositionTone(summary?.confidence ?? "low"),
            },
            {
              label: `${summary?.match_quality ?? "weak"} match`,
              tone: dispositionTone(summary?.match_quality ?? "weak"),
            },
          ];

          if (summary?.candidate_trust) {
            badges.push({
              label: `${summary.candidate_trust} trust`,
              tone: dispositionTone(summary.candidate_trust),
            });
          }

          const keyFacts: ConnectorUiFact[] = [];
          if (summary?.nearest_match) {
            keyFacts.push({ label: "Nearest match", value: summary.nearest_match });
          }
          if (summary?.semantic_score !== null && summary?.semantic_score !== undefined) {
            keyFacts.push({
              label: "Semantic score",
              value: summary.semantic_score.toFixed(3),
            });
          }
          if (
            summary?.lexical_similarity_score !== null &&
            summary?.lexical_similarity_score !== undefined
          ) {
            keyFacts.push({
              label: "Lexical score",
              value: summary.lexical_similarity_score.toFixed(3),
            });
          }
          if (
            summary?.candidate_source_rank !== null &&
            summary?.candidate_source_rank !== undefined
          ) {
            keyFacts.push({
              label: "Candidate rank",
              value: String(summary.candidate_source_rank),
            });
          }

          return {
            status: currentSnapshot.meta.status,
            headline: summary?.is_suspicious
              ? summary.nearest_match
                ? `Possible typosquat of ${summary.nearest_match}`
                : "Possible typosquat detected"
              : "No typosquat signal detected",
            disposition:
              summary?.recommended_action === "block"
                ? "blocked"
                : summary?.recommended_action === "review"
                  ? "warning"
                  : "clean",
            badges,
            keyFacts,
          };
        },
      },
    );
  }

  getFieldCatalog(): ConnectorField[] {
    const key = this.id;
    const boolOps = ["is_true", "is_false"];
    const strOps = ["eq", "ne", "in", "not_in"];
    const floatOps = ["gt", "gte", "lt", "lte"];
    const intOps = ["eq", "ne", "gt", "gte", "lt", "lte"];
    const anyOps = ["exists", "not_exists", "eq", "ne"];
    const metaStrOps = ["eq", "ne", "in", "not_in", "exists", "not_exists"];

    return [
      {
        connectorKey: key,
        fieldKey: "is_suspicious",
        canonicalRef: "source.intelligence.is_suspicious",
        label: "Suspicious Package",
        description: "Whether the intelligence service flagged this package as suspicious.",
        dataType: "boolean",
        entityType: "artifact",
        operators: boolOps,
      },
      {
        connectorKey: key,
        fieldKey: "nearest_match",
        canonicalRef: "source.intelligence.nearest_match",
        label: "Nearest Match",
        description: "Closest known package returned by the intelligence service.",
        dataType: "string",
        entityType: "artifact",
        operators: anyOps,
      },
      {
        connectorKey: key,
        fieldKey: "match_quality",
        canonicalRef: "source.intelligence.match_quality",
        label: "Match Quality",
        description: "Strength of the nearest package match.",
        dataType: "string",
        entityType: "artifact",
        operators: strOps,
        enumValues: ["weak", "ambiguous", "strong"],
      },
      {
        connectorKey: key,
        fieldKey: "recommended_action",
        canonicalRef: "source.intelligence.recommended_action",
        label: "Recommended Action",
        description: "Action recommended by the intelligence service.",
        dataType: "string",
        entityType: "artifact",
        operators: strOps,
        enumValues: ["allow", "review", "block"],
      },
      {
        connectorKey: key,
        fieldKey: "confidence",
        canonicalRef: "source.intelligence.confidence",
        label: "Confidence",
        description: "Confidence level for the intelligence verdict.",
        dataType: "string",
        entityType: "artifact",
        operators: strOps,
        enumValues: ["low", "medium", "high"],
      },
      {
        connectorKey: key,
        fieldKey: "semantic_score",
        canonicalRef: "source.intelligence.semantic_score",
        label: "Semantic Score",
        description: "Embedding similarity score for the selected candidate.",
        dataType: "float",
        entityType: "artifact",
        operators: floatOps,
      },
      {
        connectorKey: key,
        fieldKey: "lexical_similarity_score",
        canonicalRef: "source.intelligence.lexical_similarity_score",
        label: "Lexical Score",
        description: "Lexical similarity score for the selected candidate.",
        dataType: "float",
        entityType: "artifact",
        operators: floatOps,
      },
      {
        connectorKey: key,
        fieldKey: "candidate_source_rank",
        canonicalRef: "source.intelligence.candidate_source_rank",
        label: "Candidate Source Rank",
        description: "Source rank of the selected candidate package.",
        dataType: "integer",
        entityType: "artifact",
        operators: intOps,
      },
      {
        connectorKey: key,
        fieldKey: "candidate_score_final",
        canonicalRef: "source.intelligence.candidate_score_final",
        label: "Candidate Score",
        description: "Final ranking score for the selected candidate package.",
        dataType: "float",
        entityType: "artifact",
        operators: floatOps,
      },
      {
        connectorKey: key,
        fieldKey: "candidate_trust",
        canonicalRef: "source.intelligence.candidate_trust",
        label: "Candidate Trust",
        description: "Trust tier of the selected candidate package.",
        dataType: "string",
        entityType: "artifact",
        operators: strOps,
        enumValues: ["low", "medium", "high"],
      },
      {
        connectorKey: key,
        fieldKey: "adjacent_name_found_in_corpus",
        canonicalRef: "source.intelligence.adjacent_name_found_in_corpus",
        label: "Adjacent Name Found",
        description: "Whether a related adjacent package name exists in the corpus.",
        dataType: "boolean",
        entityType: "artifact",
        operators: boolOps,
      },
      {
        connectorKey: key,
        fieldKey: "judge_cache_hit",
        canonicalRef: "source.intelligence.judge_cache_hit",
        label: "Judge Cache Hit",
        description: "Whether the intelligence judge response came from cache.",
        dataType: "boolean",
        entityType: "artifact",
        operators: boolOps,
      },
      {
        connectorKey: key,
        fieldKey: "_meta.status",
        canonicalRef: "source.intelligence._meta.status",
        label: "Connector Status",
        description: "Response status of the intelligence connector for this request.",
        dataType: "string",
        entityType: "artifact",
        operators: metaStrOps,
        enumValues: [
          "ok",
          "cache_hit",
          "timeout",
          "unavailable",
          "error",
          "background_pending",
        ],
      },
      {
        connectorKey: key,
        fieldKey: "_meta.response_time_ms",
        canonicalRef: "source.intelligence._meta.response_time_ms",
        label: "Connector Response Time (ms)",
        description: "How long the connector call took for this request.",
        dataType: "integer",
        entityType: "artifact",
        operators: intOps,
      },
      {
        connectorKey: key,
        fieldKey: "_meta.cache_age_hours",
        canonicalRef: "source.intelligence._meta.cache_age_hours",
        label: "Cache Age (hours)",
        description: "How old the cached connector result is, when served from cache.",
        dataType: "float",
        entityType: "artifact",
        operators: floatOps,
      },
      {
        connectorKey: key,
        fieldKey: "_meta.is_cache_hit",
        canonicalRef: "source.intelligence._meta.is_cache_hit",
        label: "Cache Hit",
        description: "Whether the connector result came from cache.",
        dataType: "boolean",
        entityType: "artifact",
        operators: boolOps,
      },
      {
        connectorKey: key,
        fieldKey: "_meta.error_code",
        canonicalRef: "source.intelligence._meta.error_code",
        label: "Connector Error Code",
        description: "Connector-specific error code when the request did not complete cleanly.",
        dataType: "string",
        entityType: "artifact",
        operators: anyOps,
      },
    ];
  }

  getFindingSchema(): ConnectorFindingField[] {
    return [
      { key: "package", label: "Package", dataType: "string", display: "code" },
      {
        key: "nearest_match",
        label: "Nearest Match",
        dataType: "string",
        display: "code",
      },
      {
        key: "match_quality",
        label: "Match Quality",
        dataType: "string",
        display: "badge",
      },
      {
        key: "recommended_action",
        label: "Recommended Action",
        dataType: "string",
        display: "badge",
      },
      {
        key: "confidence",
        label: "Confidence",
        dataType: "string",
        display: "badge",
      },
      {
        key: "semantic_score",
        label: "Semantic Score",
        dataType: "float",
        display: "number",
      },
      {
        key: "lexical_similarity_score",
        label: "Lexical Score",
        dataType: "float",
        display: "number",
      },
      {
        key: "candidate_source_rank",
        label: "Candidate Rank",
        dataType: "integer",
        display: "number",
      },
      {
        key: "candidate_score_final",
        label: "Candidate Score",
        dataType: "float",
        display: "number",
      },
      {
        key: "candidate_trust",
        label: "Candidate Trust",
        dataType: "string",
        display: "badge",
      },
      {
        key: "adjacent_name_found_in_corpus",
        label: "Adjacent Name Found",
        dataType: "boolean",
        display: "badge",
      },
      {
        key: "judge_cache_hit",
        label: "Judge Cache Hit",
        dataType: "boolean",
        display: "badge",
      },
      {
        key: "llm_verdict",
        label: "Judge Verdict",
        dataType: "string",
      },
      {
        key: "source",
        label: "Source",
        dataType: "string",
        display: "badge",
      },
      {
        key: "latency_ms",
        label: "Latency (ms)",
        dataType: "integer",
        display: "number",
      },
    ];
  }
}
