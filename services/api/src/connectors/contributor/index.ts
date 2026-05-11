import { and, eq, sql } from "drizzle-orm";
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
  VulnerabilitySummary,
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
import {
  canonicalizeEcosystem,
  canonicalizePackageIdentity,
  canonicalizePackageName,
  canonicalizePackageVersion,
} from "../../features/packages/identity.js";
import {
  CONTRIBUTOR_METADATA_INGESTION_KIND,
  type ContributorManifestEvent,
  type ContributorManifestVersion,
  type ContributorMetadataIngestor,
} from "./types.js";

const TIER_HIGH = 80;
const TIER_MEDIUM = 40;
const CONNECTOR_ID = "contributor";
const SUPPORTED_ECOSYSTEMS = new Set(["npm"]);
export const CONTRIBUTOR_FACTS_UNAVAILABLE_ERROR =
  "contributor_facts_unavailable";

type StoredContributorSignals = ContributorSignals & {
  hasTrustedPublisher: boolean | null;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class ContributorConnector implements ContributorMetadataIngestor {
  readonly id = CONNECTOR_ID;
  readonly config: ContributorConnectorConfig;
  readonly supportedEcosystems = ["npm"] as const;
  readonly subscribedEvents = [
    { kind: "artifact_request", executionMode: "async_preferred" },
  ] as const;
  readonly cachePolicy = { readSnapshots: false } as const;
  readonly metadataIngestionKind = CONTRIBUTOR_METADATA_INGESTION_KIND;
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

  async handleEvent(event: ConnectorArtifactEvent): Promise<ConnectorEventOutcome> {
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
      scored,
      scoreToTier(scored.score),
      versionAgeTtlSeconds(stored.publishedAt, this.config),
    );
  }

  async processContributorMetadata(
    event: ContributorManifestEvent,
    eventDb: DB,
  ): Promise<void> {
    const ecosystem = canonicalizeEcosystem(event.ecosystem);
    const packageName = canonicalizePackageName(ecosystem, event.package);
    const requestedVersion = event.requestedVersion
      ? canonicalizePackageVersion(event.requestedVersion)
      : null;
    const latestVersionFromEvent = event.latestVersion
      ? canonicalizePackageVersion(event.latestVersion)
      : null;

    if (!SUPPORTED_ECOSYSTEMS.has(ecosystem)) {
      return;
    }

    const observedAt = parseRequiredDate(event.extractedAt);
    if (!observedAt) return;
    const latestPublishedAt = parseNullableDate(event.latestPublishedAt);
    const oldestIncludedPublishedAtFromEvent = parseNullableDate(
      event.oldestIncludedPublishedAt,
    );

    const inputVersions = event.versions
      .map((version) => ({
        ...version,
        publishedAtDate: parseRequiredDate(version.publishedAt),
      }))
      .filter(
        (
          version,
        ): version is ContributorManifestVersion & { publishedAtDate: Date } =>
          version.publishedAtDate !== null,
      )
      .sort(
        (a, b) => a.publishedAtDate.getTime() - b.publishedAtDate.getTime(),
      );

    if (inputVersions.length === 0) return;

    const latestVersion = [...inputVersions].sort(
      (a, b) => b.publishedAtDate.getTime() - a.publishedAtDate.getTime(),
    )[0];

    await eventDb.transaction(async (tx) => {
      const packageRow = await this.upsertPackageIdentity(tx, {
        ecosystem,
        packageName,
        observedAt,
      });

      const upsertedVersions: Array<{
        packageVersionId: string;
        version: string;
        publishedAt: Date;
        publisher: string | null;
        maintainers: string[];
        hasInstallScripts: boolean;
        hasAttestation: boolean;
        rawPayloadJson?: string | null;
      }> = [];

      for (const version of inputVersions) {
        const canonicalVersion = canonicalizePackageVersion(version.version);
        const packageVersion = await this.upsertPackageVersion(tx, {
          packageId: packageRow.id,
          version: canonicalVersion,
          publishedAt: version.publishedAtDate,
          observedAt,
        });

        upsertedVersions.push({
          packageVersionId: packageVersion.id,
          version: canonicalVersion,
          publishedAt: version.publishedAtDate,
          publisher: version.publisher?.trim() || null,
          maintainers: normalizeMaintainers(version.maintainers),
          hasInstallScripts: version.hasInstallScripts,
          hasAttestation: version.hasAttestation,
          rawPayloadJson: version.rawPayloadJson,
        });
      }

      const oldestIncludedPublishedAt =
        upsertedVersions[0]?.publishedAt ?? null;
      const latestPackageVersionId =
        upsertedVersions.find(
          (version) => version.version === latestVersion.version,
        )?.packageVersionId ?? null;

      await tx
        .update(packages)
        .set({
          latest_package_version_id: latestPackageVersionId,
          contributor_fingerprint:
            event.packageMetadataFingerprint ?? event.fingerprint,
          contributor_history_complete: event.historyComplete,
          contributor_oldest_included_published_at:
            oldestIncludedPublishedAtFromEvent ?? oldestIncludedPublishedAt,
          last_metadata_seen_at: observedAt,
          updated_at: sql`NOW()`,
        })
        .where(eq(packages.id, packageRow.id));

      const seenPublishers = new Map<string, number>();
      let priorVersionPublisher: string | null = null;
      let priorMaintainers: string[] = [];
      const firstPublishedAt = upsertedVersions[0]?.publishedAt ?? observedAt;

      const { upsertCachedResult } = await import("../cache.js");

      for (const [index, version] of upsertedVersions.entries()) {
        const addedMaintainers = difference(
          version.maintainers,
          priorMaintainers,
        );
        const removedMaintainers = difference(
          priorMaintainers,
          version.maintainers,
        );
        const publisherSeenCountBefore = version.publisher
          ? (seenPublishers.get(version.publisher) ?? 0)
          : null;
        const publisherSeenBeforePackage = version.publisher
          ? (publisherSeenCountBefore ?? 0) > 0
          : null;
        const publisherMatchesPriorVersion =
          priorVersionPublisher !== null && version.publisher !== null
            ? priorVersionPublisher === version.publisher
            : null;
        const maintainerSetChanged =
          index === 0
            ? null
            : !sameMembers(version.maintainers, priorMaintainers);

        const releaseVelocity7d = countVersionsInWindow(
          upsertedVersions,
          version.publishedAt,
          7,
        );
        const releaseVelocity30d = countVersionsInWindow(
          upsertedVersions,
          version.publishedAt,
          30,
        );

        const storedSignals: StoredContributorSignals = {
          version: version.version,
          publishedAt: version.publishedAt,
          publisher: version.publisher,
          publisherSeenBeforePackage,
          publisherSeenCountBefore,
          publisherMatchesPriorVersion,
          priorVersionPublisher,
          maintainerSetChanged,
          newMaintainerCount: addedMaintainers.length,
          removedMaintainerCount: removedMaintainers.length,
          maintainerCount: version.maintainers.length,
          hasInstallScripts: version.hasInstallScripts,
          hasProvenance: version.hasAttestation,
          hasTrustedPublisher: null,
          releaseVelocity7d,
          releaseVelocity30d,
          historyComplete: event.historyComplete,
        };

        await tx
          .insert(contributor_release_facts)
          .values({
            package_version_id: version.packageVersionId,
            published_at: version.publishedAt,
            source_kind: "npm_manifest",
            source_payload_version: "1",
            source_payload: parseRawPayload(version.rawPayloadJson, {
              ecosystem,
              package: packageName,
              version: version.version,
              published_at: version.publishedAt.toISOString(),
              publisher: version.publisher,
              maintainers: version.maintainers,
              scripts: {
                has_install_scripts: version.hasInstallScripts,
              },
              provenance: {
                has_attestation: version.hasAttestation,
              },
            }),
            source_observed_at: observedAt,
            publish_actor: version.publisher,
            publish_actor_kind: version.publisher ? "publisher" : null,
            publisher_username: version.publisher,
            publisher_source: version.publisher ? "npm__npmUser.name" : null,
            maintainer_count: version.maintainers.length,
            maintainers: version.maintainers,
            maintainer_source: "npm_maintainers",
            has_install_scripts: version.hasInstallScripts,
            has_provenance: version.hasAttestation,
            publisher_seen_before_package: publisherSeenBeforePackage,
            publisher_seen_count_before: publisherSeenCountBefore,
            publisher_matches_prior_version: publisherMatchesPriorVersion,
            prior_package_version_id:
              index > 0 ? upsertedVersions[index - 1]?.packageVersionId : null,
            prior_version_publish_actor: priorVersionPublisher,
            maintainer_set_changed: maintainerSetChanged,
            maintainers_added: addedMaintainers,
            maintainers_removed: removedMaintainers,
            new_maintainer_count: addedMaintainers.length,
            removed_maintainer_count: removedMaintainers.length,
            release_velocity_7d_at_publish: releaseVelocity7d,
            release_velocity_30d_at_publish: releaseVelocity30d,
            first_published_at_for_package: firstPublishedAt,
            package_release_index: index,
            history_complete: event.historyComplete,
            observed_at: observedAt,
            updated_at: sql`NOW()`,
          })
          .onConflictDoUpdate({
            target: [contributor_release_facts.package_version_id],
            set: {
              published_at: version.publishedAt,
              source_kind: "npm_manifest",
              source_payload_version: "1",
              source_payload: parseRawPayload(version.rawPayloadJson, {
                ecosystem,
                package: packageName,
                version: version.version,
                published_at: version.publishedAt.toISOString(),
                publisher: version.publisher,
                maintainers: version.maintainers,
                scripts: {
                  has_install_scripts: version.hasInstallScripts,
                },
                provenance: {
                  has_attestation: version.hasAttestation,
                },
              }),
              source_observed_at: observedAt,
              publish_actor: version.publisher,
              publish_actor_kind: version.publisher ? "publisher" : null,
              publisher_username: version.publisher,
              publisher_source: version.publisher ? "npm__npmUser.name" : null,
              maintainer_count: version.maintainers.length,
              maintainers: version.maintainers,
              maintainer_source: "npm_maintainers",
              has_install_scripts: version.hasInstallScripts,
              has_provenance: version.hasAttestation,
              publisher_seen_before_package: publisherSeenBeforePackage,
              publisher_seen_count_before: publisherSeenCountBefore,
              publisher_matches_prior_version: publisherMatchesPriorVersion,
              prior_package_version_id:
                index > 0
                  ? upsertedVersions[index - 1]?.packageVersionId
                  : null,
              prior_version_publish_actor: priorVersionPublisher,
              maintainer_set_changed: maintainerSetChanged,
              maintainers_added: addedMaintainers,
              maintainers_removed: removedMaintainers,
              new_maintainer_count: addedMaintainers.length,
              removed_maintainer_count: removedMaintainers.length,
              release_velocity_7d_at_publish: releaseVelocity7d,
              release_velocity_30d_at_publish: releaseVelocity30d,
              first_published_at_for_package: firstPublishedAt,
              package_release_index: index,
              history_complete: event.historyComplete,
              observed_at: observedAt,
              updated_at: sql`NOW()`,
            },
          });

        const scored = this.scorer.score(storedSignals);
        await upsertCachedResult(
          tx as unknown as DB,
          this,
          {
            id: `${CONNECTOR_ID}:${version.packageVersionId}`,
            kind: "artifact_request",
            packageId: packageRow.id,
            packageVersionId: version.packageVersionId,
            ecosystem,
            packageName,
            version: version.version,
            source: "proxy",
            observedAt: observedAt.toISOString(),
          },
          scoreToConnectorResult(
            scored,
            scoreToTier(scored.score),
            versionAgeTtlSeconds(version.publishedAt, this.config),
          ),
        );

        if (version.publisher) {
          seenPublishers.set(
            version.publisher,
            (seenPublishers.get(version.publisher) ?? 0) + 1,
          );
        }
        priorVersionPublisher = version.publisher;
        priorMaintainers = version.maintainers;
      }

      if (latestVersionFromEvent && latestPublishedAt) {
        const latestRow = upsertedVersions.find(
          (version) => version.version === latestVersionFromEvent,
        );

        if (!latestRow) {
          const packageVersion = await this.upsertPackageVersion(tx, {
            packageId: packageRow.id,
            version: latestVersionFromEvent,
            publishedAt: latestPublishedAt,
            observedAt,
          });

          await tx
            .update(packages)
            .set({
              latest_package_version_id: packageVersion.id,
              contributor_fingerprint:
                event.packageMetadataFingerprint ?? event.fingerprint,
              contributor_history_complete: event.historyComplete,
              contributor_oldest_included_published_at:
                oldestIncludedPublishedAtFromEvent ?? oldestIncludedPublishedAt,
              last_metadata_seen_at: observedAt,
              updated_at: sql`NOW()`,
            })
            .where(eq(packages.id, packageRow.id));
        }
      }

      if (requestedVersion && event.sliceFingerprint) {
        const requestedRow = upsertedVersions.find(
          (version) => version.version === requestedVersion,
        );
        if (requestedRow) {
          await tx
            .update(package_versions)
            .set({
              contributor_slice_fingerprint: event.sliceFingerprint,
              contributor_slice_observed_at: observedAt,
              updated_at: sql`NOW()`,
            })
            .where(eq(package_versions.id, requestedRow.packageVersionId));
        }
      }
    });
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
    const vulnerability = result.summary?.vulnerability;

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
        contributor_risk_score: vulnerability?.findingCount ?? 0,
        score_tier: vulnerability?.maxSeverity ?? "NONE",
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

          const vulnerability = currentResult?.summary?.vulnerability;
          const score = vulnerability?.findingCount ?? 0;
          const tier = vulnerability?.maxSeverity ?? "NONE";
          const attributes = currentResult?.findings[0]?.attributes ?? {};
          const badges: ConnectorUiBadge[] = [
            ...buildStatusBadges(currentSnapshot),
            {
              label: `${tier} tier`,
              tone:
                tier === "HIGH"
                  ? "bad"
                  : tier === "MEDIUM"
                    ? "warn"
                    : "good",
            },
          ];
          const keyFacts: ConnectorUiFact[] = [
            { label: "Risk score", value: String(score) },
          ];

          if (typeof attributes.publisher === "string" && attributes.publisher) {
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

  private async upsertPackageIdentity(
    tx: Tx,
    input: {
      ecosystem: string;
      packageName: string;
      observedAt: Date;
    },
  ): Promise<{ id: string }> {
    const ecosystem = canonicalizeEcosystem(input.ecosystem);
    const packageName = canonicalizePackageName(ecosystem, input.packageName);

    const [row] = await tx
      .insert(packages)
      .values({
        ecosystem,
        package: packageName,
        last_metadata_seen_at: input.observedAt,
      })
      .onConflictDoUpdate({
        target: [packages.ecosystem, packages.package],
        set: {
          last_metadata_seen_at: input.observedAt,
          updated_at: sql`NOW()`,
        },
      })
      .returning({ id: packages.id });

    return row;
  }

  private async upsertPackageVersion(
    tx: Tx,
    input: {
      packageId: string;
      version: string;
      publishedAt: Date;
      observedAt: Date;
    },
  ): Promise<{ id: string }> {
    const version = canonicalizePackageVersion(input.version);

    const [row] = await tx
      .insert(package_versions)
      .values({
        package_id: input.packageId,
        version,
        published_at: input.publishedAt,
        last_metadata_seen_at: input.observedAt,
      })
      .onConflictDoUpdate({
        target: [package_versions.package_id, package_versions.version],
        set: {
          published_at: input.publishedAt,
          last_metadata_seen_at: input.observedAt,
          updated_at: sql`NOW()`,
        },
      })
      .returning({ id: package_versions.id });

    return row;
  }
}

function parseRequiredDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseNullableDate(value: string | null): Date | null {
  if (!value) return null;
  return parseRequiredDate(value);
}

function parseRawPayload(
  rawPayloadJson: string | null | undefined,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  if (!rawPayloadJson) return fallback;
  try {
    const parsed = JSON.parse(rawPayloadJson) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // Invalid JSON falls back to the default payload shape.
  }
  return fallback;
}

function normalizeMaintainers(maintainers: string[]): string[] {
  return [
    ...new Set(maintainers.map((value) => value.trim()).filter(Boolean)),
  ].sort();
}

function sameMembers(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function difference(source: string[], other: string[]): string[] {
  const otherSet = new Set(other);
  return source.filter((value) => !otherSet.has(value));
}

function countVersionsInWindow(
  versions: Array<{ publishedAt: Date }>,
  pivot: Date,
  days: number,
): number {
  const cutoff = pivot.getTime() - days * 86_400_000;
  return versions.filter((version) => {
    const publishedAt = version.publishedAt.getTime();
    return publishedAt >= cutoff && publishedAt <= pivot.getTime();
  }).length;
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
      vulnerability: {
        maxSeverity: "NONE",
        findingCount: 0,
        fixAvailable: false,
        bestFixVersion: null,
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
  scored: ReturnType<ContributorScorer["score"]>,
  scoreTier: VulnSeverity,
  ttlSeconds?: number,
): ConnectorResult {
  const normalizedScore = Math.round(scored.score);
  const vulnerabilitySummary: VulnerabilitySummary = {
    maxSeverity: scoreTier,
    findingCount: normalizedScore,
    fixAvailable: false,
    bestFixVersion: null,
  };

  return {
    summary: {
      vulnerability: vulnerabilitySummary,
    },
    findings: [
      {
        findingId: "contributor_signals",
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
