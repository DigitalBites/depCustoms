import type { Violation } from "@/features/policies/types";
import type {
  ContributorFindingSummary,
  OsvPackageProject,
  VulnDetail,
} from "@/features/findings/types";

import type {
  Severity,
  ViolationStatus,
} from "@customs/shared-constants";

export interface ViolationsSummary {
  statusCounts: { open: number; resolved: number; suppressed: number };
  severityCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  blockedCount: number;
  advisoryCount: number;
  trend: { thisWeek: number; priorWeek: number; delta: number };
  activeSuppressionsCount: number;
  computedAt: string;
}

export type StatusFilter = "all" | ViolationStatus;

export type SeverityFilter = "all" | Severity;

export type EnrichedViolation = Violation & {
  project_name?: string | null;
  rule_name?: string | null;
  finding_count?: number;
  status_note?: string | null;
};

export interface AdvisoryDetail {
  published_at: string | null;
  attributes: Record<string, unknown>;
}

export interface ConnectorFindingField {
  key: string;
  label: string;
  dataType:
    | "integer"
    | "float"
    | "boolean"
    | "string"
    | "datetime"
    | "string[]";
  display?: "badge" | "code" | "url" | "date" | "number";
}

export interface ConnectorFindingSummary {
  findingId: string;
  severity: string;
  title: string | null;
  publishedAt: string | null;
}

export interface ConnectorUiBadge {
  label: string;
  tone: "neutral" | "good" | "warn" | "bad";
}

export interface ConnectorUiFact {
  label: string;
  value: string;
}

export interface ConnectorUiSummary {
  status: string;
  headline: string;
  disposition?: string;
  score?: number | null;
  badges?: ConnectorUiBadge[];
  keyFacts?: ConnectorUiFact[];
}

export interface ConnectorPresentation {
  summary: ConnectorUiSummary;
  findings: ConnectorFindingSummary[];
  findingSchema: ConnectorFindingField[];
}

export interface ViolationFinding {
  id: string;
  connector_key: string;
  finding_id: string;
  title: string | null;
  severity: string;
  observation_status: string;
  advisory: AdvisoryDetail | null;
  first_seen_at?: string;
  last_seen_at?: string;
}

export interface ExpansionData {
  findings: ViolationFinding[];
  findingSchemas: Record<string, ConnectorFindingField[]>;
  presentations: Record<string, ConnectorPresentation>;
  field_values_at_evaluation: Record<string, unknown>;
}

export type ViolationWithFindings = Violation & {
  findings: ViolationFinding[];
  findingSchemas: Record<string, ConnectorFindingField[]>;
  presentations?: Record<string, ConnectorPresentation>;
  latestEvaluation?: {
    id: string;
    event_id: string | null;
    evaluated_at: string;
    field_values_at_evaluation: Record<string, unknown>;
  } | null;
  recommended_remediation?: string | null;
  status_note?: string | null;
  project_name?: string | null;
  policy_name?: string | null;
  rule_name?: string | null;
};

export interface ViolationEntityItem {
  id: string;
  projectId: string;
  projectName: string | null;
  ruleName: string | null;
  policyName: string | null;
  severity: string;
  message: string;
  enforcementMode: string;
  blocked: boolean;
  status: ViolationStatus;
  statusNote: string | null;
  recommendedRemediation: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
}

export interface ViolationEntitySummary {
  packageId: string;
  packageVersionId: string;
  ecosystem: string;
  name: string;
  version: string;
  displayName: string;
  latestEvaluatedAt: string;
  openCount: number;
  resolvedCount: number;
  suppressedCount: number;
  blockedOpenCount: number;
  advisoryOpenCount: number;
  highestSeverity: string;
  projects: OsvPackageProject[];
  violations: ViolationEntityItem[];
  evidence: {
    osv: {
      hasFindings: boolean;
      highestSeverity: string;
      vulnCount: number;
      fixAvailable: boolean;
      bestFixVersion: string | null;
      latestVersion: string | null;
      latestVersionPublishedAt: string | null;
      networkExploitable: boolean;
      observationStatus: string | null;
      findings: {
        id: string;
        findingId: string;
        severity: string;
        observationStatus: string;
      }[];
      vulns: VulnDetail[];
    } | null;
    intelligence: {
      hasFinding: boolean;
      nearestMatch: string | null;
      recommendedAction: string;
      confidence: string;
      matchQuality: string;
      candidateTrust: string | null;
      llmVerdict: string | null;
      semanticScore: number | null;
      lexicalSimilarityScore: number | null;
      observationStatus: string | null;
      findings: {
        id: string;
        findingId: string;
        severity: string;
        observationStatus: string;
      }[];
    } | null;
    contributor: ContributorFindingSummary | null;
  };
}

export interface ViolationEntitiesResponse {
  entities: ViolationEntitySummary[];
  pagination: {
    total: number;
    offset: number;
    limit: number;
  };
}

export interface ViolationsListResponse {
  violations: EnrichedViolation[];
  limit: number;
  offset: number;
}

export interface ViolationDetailResponse {
  violation: ViolationWithFindings;
}

export interface BulkViolationStatusResponse {
  updated_ids: string[];
}
