import { and, eq } from "drizzle-orm";
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
  VulnSeverity,
} from "../types.js";
import type { DB } from "../../db/index.js";
import { db } from "../../db/index.js";
import {
  contributor_release_facts,
  packages,
  package_versions,
} from "../../db/schema.js";
import type { ContributorConnectorConfig } from "./config.js";
import {
  ContributorScorer,
  type ContributorSignals,
  SCORE_MODEL_VERSION,
} from "./scorer.js";
import {
  buildDefaultConnectorPresentation,
  buildStatusBadges,
  buildStatusFacts,
} from "../presentation.js";
import { canonicalizePackageIdentity } from "../../features/packages/identity.js";
import { CONTRIBUTOR_CONNECTOR_ID } from "./types.js";

const TIER_HIGH = 80;
const TIER_MEDIUM = 40;
const CONNECTOR_ID = CONTRIBUTOR_CONNECTOR_ID;
const SUPPORTED_ECOSYSTEMS = new Set(["npm"]);
export const CONTRIBUTOR_FACTS_UNAVAILABLE_ERROR =
  "contributor_facts_unavailable";

type StoredContributorSignals = ContributorSignals & {
  hasTrustedPublisher: boolean | null;
};

export class ContributorConnector {
  readonly id = CONNECTOR_ID;
  readonly config: ContributorConnectorConfig;
  readonly supportedEcosystems = ["npm"] as const;
  readonly subscribedEvents = [
    { kind: "artifact_request", executionMode: "async_preferred" },
  ] as const;
  readonly cachePolicy = { readSnapshots: false } as const;
  private readonly scorer = new ContributorScorer();

  constructor(config: ContributorConnectorConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {}

  async shutdown(): Promise<void> {}

  supportsEvent(event: ConnectorArtifactEvent): boolean {
    return (
      SUPPORTED_ECOSYSTEMS.has(event.ecosystem.toLowerCase()) &&
      event.kind === "artifact_request" &&
      event.version !== null
    );
  }

  async handleEvent(
    event: ConnectorArtifactEvent,
  ): Promise<ConnectorEventOutcome> {
    if (!this.supportsEvent(event) || event.version === null) {
      return null;
    }
    return this.fetchArtifactSignals(
      event.ecosystem,
      event.packageName,
      event.version,
    );
  }

  private async fetchArtifactSignals(
    ecosystem: string,
    pkg: string,
    version: string,
  ): Promise<ConnectorResult> {
    const identity = canonicalizePackageIdentity({
      ecosystem,
      package: pkg,
      version,
    });

    if (!SUPPORTED_ECOSYSTEMS.has(identity.ecosystem)) {
      return emptyResult();
    }
    if (!identity.version) {
      return emptyResult();
    }

    const stored = await this.loadStoredSignals(
      db,
      identity.ecosystem,
      identity.package,
      identity.version,
    );
    if (!stored) {
      throw new Error(CONTRIBUTOR_FACTS_UNAVAILABLE_ERROR);
    }

    const scored = this.scorer.score(stored);
    return scoreToConnectorResult(
      identity.ecosystem,
      identity.package,
      identity.version,
      scored,
      scoreToTier(scored.score),
      versionAgeTtlSeconds(stored.publishedAt, this.config),
    );
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

    if (!result || failureStatus) {
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

    const attributes = result.findings[0]?.attributes ?? {};
    const risk = result.summary?.risk;

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
        contributor_risk_score: risk?.score ?? 0,
        score_tier: risk?.tier ?? "NONE",
        score_model_version:
          attributes.score_model_version ?? SCORE_MODEL_VERSION,
        publisher_seen_before_package:
          attributes.publisher_seen_before_package ?? null,
        publisher_seen_count_before:
          attributes.publisher_seen_count_before ?? null,
        publisher_matches_prior_version:
          attributes.publisher_matches_prior_version ?? null,
        maintainer_set_changed: attributes.maintainer_set_changed ?? null,
        new_maintainer_count: attributes.new_maintainer_count ?? null,
        removed_maintainer_count: attributes.removed_maintainer_count ?? null,
        maintainer_count: attributes.maintainer_count ?? null,
        has_install_scripts: attributes.has_install_scripts ?? null,
        has_provenance: attributes.has_provenance ?? null,
        has_trusted_publisher: attributes.has_trusted_publisher ?? null,
        release_velocity_7d: attributes.release_velocity_7d ?? null,
        release_velocity_30d: attributes.release_velocity_30d ?? null,
        history_complete: attributes.history_complete ?? null,
        scan_age_hours: context.cacheAgeHours,
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
        connectorLabel: "Contributor",
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
              headline: `Contributor: ${currentSnapshot.meta.status.replaceAll("_", " ")}`,
              disposition: "unavailable",
              badges: buildStatusBadges(currentSnapshot),
              keyFacts: buildStatusFacts(currentSnapshot),
            };
          }

          const risk = currentResult?.summary?.risk;
          const score = risk?.score ?? 0;
          const tier = risk?.tier ?? "NONE";
          const attributes = currentResult?.findings[0]?.attributes ?? {};
          const badges: ConnectorUiBadge[] = [
            ...buildStatusBadges(currentSnapshot),
            {
              label: `${tier} tier`,
              tone:
                tier === "HIGH" ? "bad" : tier === "MEDIUM" ? "warn" : "good",
            },
          ];
          const keyFacts: ConnectorUiFact[] = [
            { label: "Risk score", value: String(score) },
          ];

          if (
            typeof attributes.publisher === "string" &&
            attributes.publisher
          ) {
            keyFacts.push({ label: "Publisher", value: attributes.publisher });
          }
          if (typeof attributes.new_maintainer_count === "number") {
            keyFacts.push({
              label: "New maintainers",
              value: String(attributes.new_maintainer_count),
            });
          }
          if (typeof attributes.release_velocity_30d === "number") {
            keyFacts.push({
              label: "Releases (30d)",
              value: String(attributes.release_velocity_30d),
            });
          }

          return {
            status: currentSnapshot.meta.status,
            headline:
              score === 0
                ? "Contributor risk score 0"
                : `Contributor risk score ${score}`,
            disposition:
              tier === "HIGH"
                ? "elevated"
                : tier === "MEDIUM"
                  ? "warning"
                  : "clean",
            score,
            badges,
            keyFacts,
          };
        },
      },
    );
  }

  getFieldCatalog(): ConnectorField[] {
    const key = this.id;
    const intOps = ["eq", "ne", "gt", "gte", "lt", "lte"];
    const strOps = ["eq", "ne", "in", "not_in"];
    const boolOps = ["is_true", "is_false"];
    const floatOps = ["gt", "gte", "lt", "lte"];
    const metaStrOps = ["eq", "ne", "in", "not_in", "exists", "not_exists"];
    const anyOps = ["exists", "not_exists", "eq", "ne"];

    return [
      {
        connectorKey: key,
        fieldKey: "contributor_risk_score",
        canonicalRef: "source.contributor.contributor_risk_score",
        label: "Contributor Risk Score",
        description:
          "Composite risk score 0–100 based on publish-history and maintainer continuity signals",
        dataType: "integer",
        entityType: "artifact",
        operators: intOps,
      },
      {
        connectorKey: key,
        fieldKey: "score_tier",
        canonicalRef: "source.contributor.score_tier",
        label: "Risk Tier",
        description: "Bucketed contributor risk tier",
        dataType: "string",
        entityType: "artifact",
        operators: strOps,
        enumValues: ["NONE", "LOW", "MEDIUM", "HIGH"],
      },
      {
        connectorKey: key,
        fieldKey: "score_model_version",
        canonicalRef: "source.contributor.score_model_version",
        label: "Score Model Version",
        description: "Contributor score model version used for this evaluation",
        dataType: "string",
        entityType: "artifact",
        operators: strOps,
      },
      {
        connectorKey: key,
        fieldKey: "publisher_seen_before_package",
        canonicalRef: "source.contributor.publisher_seen_before_package",
        label: "Publisher Seen Before",
        description:
          "True when this publish actor was already seen on an earlier version of the same package",
        dataType: "boolean",
        entityType: "artifact",
        operators: boolOps,
      },
      {
        connectorKey: key,
        fieldKey: "publisher_seen_count_before",
        canonicalRef: "source.contributor.publisher_seen_count_before",
        label: "Prior Publisher Uses",
        description:
          "How many earlier versions of this package were published by the same actor",
        dataType: "integer",
        entityType: "artifact",
        operators: intOps,
      },
      {
        connectorKey: key,
        fieldKey: "publisher_matches_prior_version",
        canonicalRef: "source.contributor.publisher_matches_prior_version",
        label: "Publisher Matches Prior Version",
        description:
          "True when the publish actor matches the immediately prior version",
        dataType: "boolean",
        entityType: "artifact",
        operators: boolOps,
      },
      {
        connectorKey: key,
        fieldKey: "maintainer_set_changed",
        canonicalRef: "source.contributor.maintainer_set_changed",
        label: "Maintainer Set Changed",
        description:
          "True when the maintainer set differs from the immediately prior version",
        dataType: "boolean",
        entityType: "artifact",
        operators: boolOps,
      },
      {
        connectorKey: key,
        fieldKey: "new_maintainer_count",
        canonicalRef: "source.contributor.new_maintainer_count",
        label: "New Maintainer Count",
        description: "Number of maintainers added versus the prior version",
        dataType: "integer",
        entityType: "artifact",
        operators: intOps,
      },
      {
        connectorKey: key,
        fieldKey: "removed_maintainer_count",
        canonicalRef: "source.contributor.removed_maintainer_count",
        label: "Removed Maintainer Count",
        description: "Number of maintainers removed versus the prior version",
        dataType: "integer",
        entityType: "artifact",
        operators: intOps,
      },
      {
        connectorKey: key,
        fieldKey: "maintainer_count",
        canonicalRef: "source.contributor.maintainer_count",
        label: "Maintainer Count",
        description: "Maintainer count observed on this version",
        dataType: "integer",
        entityType: "artifact",
        operators: intOps,
      },
      {
        connectorKey: key,
        fieldKey: "has_install_scripts",
        canonicalRef: "source.contributor.has_install_scripts",
        label: "Has Install Scripts",
        description:
          "Whether install, preinstall, or postinstall scripts were observed",
        dataType: "boolean",
        entityType: "artifact",
        operators: boolOps,
      },
      {
        connectorKey: key,
        fieldKey: "has_provenance",
        canonicalRef: "source.contributor.has_provenance",
        label: "Has Provenance",
        description: "Whether provenance or attestation data was observed",
        dataType: "boolean",
        entityType: "artifact",
        operators: boolOps,
      },
      {
        connectorKey: key,
        fieldKey: "has_trusted_publisher",
        canonicalRef: "source.contributor.has_trusted_publisher",
        label: "Trusted Publisher",
        description: "Whether the release used a trusted publisher flow",
        dataType: "boolean",
        entityType: "artifact",
        operators: boolOps,
      },
      {
        connectorKey: key,
        fieldKey: "release_velocity_7d",
        canonicalRef: "source.contributor.release_velocity_7d",
        label: "Release Velocity 7d",
        description:
          "How many releases landed in the prior seven-day window at publish time",
        dataType: "integer",
        entityType: "artifact",
        operators: intOps,
      },
      {
        connectorKey: key,
        fieldKey: "release_velocity_30d",
        canonicalRef: "source.contributor.release_velocity_30d",
        label: "Release Velocity 30d",
        description:
          "How many releases landed in the prior 30-day window at publish time",
        dataType: "integer",
        entityType: "artifact",
        operators: intOps,
      },
      {
        connectorKey: key,
        fieldKey: "history_complete",
        canonicalRef: "source.contributor.history_complete",
        label: "History Complete",
        description:
          "Whether contributor history for this package is known to be complete",
        dataType: "boolean",
        entityType: "artifact",
        operators: boolOps,
      },
      {
        connectorKey: key,
        fieldKey: "scan_age_hours",
        canonicalRef: "source.contributor.scan_age_hours",
        label: "Scan Age (hours)",
        description: "How old the cached contributor score is",
        dataType: "float",
        entityType: "artifact",
        operators: floatOps,
      },
      {
        connectorKey: key,
        fieldKey: "_meta.status",
        canonicalRef: "source.contributor._meta.status",
        label: "Connector Status",
        description: "Contributor connector response status",
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
        canonicalRef: "source.contributor._meta.response_time_ms",
        label: "Response Time (ms)",
        description: "Contributor connector evaluation latency",
        dataType: "integer",
        entityType: "artifact",
        operators: intOps,
      },
      {
        connectorKey: key,
        fieldKey: "_meta.cache_age_hours",
        canonicalRef: "source.contributor._meta.cache_age_hours",
        label: "Cache Age (hours)",
        description: "Hours since the cached contributor score was written",
        dataType: "float",
        entityType: "artifact",
        operators: floatOps,
      },
      {
        connectorKey: key,
        fieldKey: "_meta.is_cache_hit",
        canonicalRef: "source.contributor._meta.is_cache_hit",
        label: "Is Cache Hit",
        description: "True when the contributor result came from cache",
        dataType: "boolean",
        entityType: "artifact",
        operators: boolOps,
      },
      {
        connectorKey: key,
        fieldKey: "_meta.error_code",
        canonicalRef: "source.contributor._meta.error_code",
        label: "Error Code",
        description: "Machine-readable connector error code",
        dataType: "string",
        entityType: "artifact",
        operators: anyOps,
      },
    ];
  }

  getFindingSchema(): ConnectorFindingField[] {
    return [
      {
        key: "score",
        label: "Risk Score",
        dataType: "integer",
        display: "number",
      },
      {
        key: "publisher",
        label: "Publisher",
        dataType: "string",
        display: "code",
      },
      {
        key: "publisher_seen_before_package",
        label: "Publisher Seen Before",
        dataType: "boolean",
        display: "badge",
      },
      {
        key: "publisher_matches_prior_version",
        label: "Publisher Matches Prior",
        dataType: "boolean",
        display: "badge",
      },
      {
        key: "new_maintainer_count",
        label: "New Maintainers",
        dataType: "integer",
        display: "number",
      },
      {
        key: "removed_maintainer_count",
        label: "Removed Maintainers",
        dataType: "integer",
        display: "number",
      },
      {
        key: "has_install_scripts",
        label: "Install Scripts",
        dataType: "boolean",
        display: "badge",
      },
      {
        key: "has_provenance",
        label: "Provenance",
        dataType: "boolean",
        display: "badge",
      },
      {
        key: "release_velocity_7d",
        label: "Releases (7d)",
        dataType: "integer",
        display: "number",
      },
      {
        key: "release_velocity_30d",
        label: "Releases (30d)",
        dataType: "integer",
        display: "number",
      },
    ];
  }

  private async loadStoredSignals(
    database: DB,
    ecosystem: string,
    pkg: string,
    version: string,
  ): Promise<StoredContributorSignals | null> {
    const identity = canonicalizePackageIdentity({
      ecosystem,
      package: pkg,
      version,
    });
    if (!identity.version) {
      return null;
    }

    const rows = await database
      .select({
        publishedAt: contributor_release_facts.published_at,
        publisher: contributor_release_facts.publish_actor,
        publisherSeenBeforePackage:
          contributor_release_facts.publisher_seen_before_package,
        publisherSeenCountBefore:
          contributor_release_facts.publisher_seen_count_before,
        publisherMatchesPriorVersion:
          contributor_release_facts.publisher_matches_prior_version,
        priorVersionPublisher:
          contributor_release_facts.prior_version_publish_actor,
        maintainerSetChanged: contributor_release_facts.maintainer_set_changed,
        newMaintainerCount: contributor_release_facts.new_maintainer_count,
        removedMaintainerCount:
          contributor_release_facts.removed_maintainer_count,
        maintainerCount: contributor_release_facts.maintainer_count,
        hasInstallScripts: contributor_release_facts.has_install_scripts,
        hasProvenance: contributor_release_facts.has_provenance,
        hasTrustedPublisher: contributor_release_facts.has_trusted_publisher,
        releaseVelocity7d:
          contributor_release_facts.release_velocity_7d_at_publish,
        releaseVelocity30d:
          contributor_release_facts.release_velocity_30d_at_publish,
        historyComplete: contributor_release_facts.history_complete,
      })
      .from(contributor_release_facts)
      .innerJoin(
        package_versions,
        eq(package_versions.id, contributor_release_facts.package_version_id),
      )
      .innerJoin(packages, eq(packages.id, package_versions.package_id))
      .where(
        and(
          eq(packages.ecosystem, identity.ecosystem),
          eq(packages.package, identity.package),
          eq(package_versions.version, identity.version),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row?.publishedAt) return null;

    return {
      version,
      publishedAt: row.publishedAt,
      publisher: row.publisher,
      publisherSeenBeforePackage: row.publisherSeenBeforePackage,
      publisherSeenCountBefore: row.publisherSeenCountBefore,
      publisherMatchesPriorVersion: row.publisherMatchesPriorVersion,
      priorVersionPublisher: row.priorVersionPublisher,
      maintainerSetChanged: row.maintainerSetChanged,
      newMaintainerCount: row.newMaintainerCount,
      removedMaintainerCount: row.removedMaintainerCount,
      maintainerCount: row.maintainerCount,
      hasInstallScripts: row.hasInstallScripts,
      hasProvenance: row.hasProvenance,
      hasTrustedPublisher: row.hasTrustedPublisher,
      releaseVelocity7d: row.releaseVelocity7d,
      releaseVelocity30d: row.releaseVelocity30d,
      historyComplete: row.historyComplete,
    };
  }
}

function versionAgeTtlSeconds(
  publishedAt: Date,
  config: ContributorConnectorConfig,
): number {
  if (config.cacheTtlOverrideSeconds !== null) {
    return config.cacheTtlOverrideSeconds;
  }
  const ageDays = (Date.now() - publishedAt.getTime()) / 86_400_000;
  if (ageDays < 1) return 3_600;
  if (ageDays < 7) return 21_600;
  if (ageDays < 30) return 86_400;
  return 259_200;
}

function emptyResult(): ConnectorResult {
  return {
    summary: {
      risk: {
        tier: "NONE",
        score: 0,
      },
      findings: {
        count: 0,
      },
      remediation: {
        available: false,
        best: null,
      },
    },
    findings: [],
  };
}

function scoreToTier(score: number): VulnSeverity {
  if (score >= TIER_HIGH) return "HIGH";
  if (score >= TIER_MEDIUM) return "MEDIUM";
  if (score > 0) return "LOW";
  return "NONE";
}

function scoreToConnectorResult(
  ecosystem: string,
  pkg: string,
  version: string,
  scored: ReturnType<ContributorScorer["score"]>,
  scoreTier: VulnSeverity,
  ttlSeconds?: number,
): ConnectorResult {
  const normalizedScore = Math.round(scored.score);
  return {
    summary: {
      risk: {
        tier: scoreTier,
        score: normalizedScore,
      },
      findings: {
        count: 1,
      },
      remediation: {
        available: false,
        best: null,
      },
    },
    findings: [
      {
        findingId: `${ecosystem}:${pkg}@${version}:contributor_signals`,
        severity: scoreTier,
        title: `Contributor risk score: ${normalizedScore}`,
        publishedAt: scored.publishedAt,
        attributes: {
          score: normalizedScore,
          score_model_version: SCORE_MODEL_VERSION,
          publisher: scored.publisher,
          publisher_seen_before_package: scored.publisherSeenBeforePackage,
          publisher_seen_count_before: scored.publisherSeenCountBefore,
          publisher_matches_prior_version: scored.publisherMatchesPriorVersion,
          prior_version_publisher: scored.priorVersionPublisher,
          maintainer_set_changed: scored.maintainerSetChanged,
          new_maintainer_count: scored.newMaintainerCount,
          removed_maintainer_count: scored.removedMaintainerCount,
          maintainer_count: scored.maintainerCount,
          has_install_scripts: scored.hasInstallScripts,
          has_provenance: scored.hasProvenance,
          has_trusted_publisher: scored.hasTrustedPublisher,
          release_velocity_7d: scored.releaseVelocity7d,
          release_velocity_30d: scored.releaseVelocity30d,
          history_complete: scored.historyComplete,
          published_at: scored.publishedAt.toISOString(),
          raw_factors: scored.rawFactors,
          signals_available: scored.signalsAvailable,
        },
      },
    ],
    ttlSeconds,
  };
}
