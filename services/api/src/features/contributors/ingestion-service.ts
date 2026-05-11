import { eq, sql } from "drizzle-orm";
import type { DB, db } from "../../db/index.js";
import {
  contributor_package_facts,
  contributor_release_facts,
  packages,
  package_versions,
} from "../../db/schema.js";
import type {
  ConnectorArtifactEvent,
  ConnectorResult,
  PackageIntelligenceConnector,
  VulnSeverity,
} from "../../connectors/types.js";
import { upsertCachedResult } from "../../connectors/cache.js";
import { ContributorConnectorConfig } from "../../connectors/contributor/config.js";
import {
  ContributorScorer,
  type ContributorSignals,
  SCORE_MODEL_VERSION,
} from "../../connectors/contributor/scorer.js";
import type {
  ContributorManifestEvent,
  ContributorManifestVersion,
} from "../../connectors/contributor/types.js";
import {
  CONTRIBUTOR_CONNECTOR_ID,
  isContributorConnectorRegistered,
} from "../../connectors/contributor/types.js";
import type { PackageIntelligenceConnector as RegisteredConnector } from "../../connectors/types.js";
import {
  canonicalizeEcosystem,
  canonicalizePackageName,
  canonicalizePackageVersion,
} from "../packages/identity.js";

const TIER_HIGH = 80;
const TIER_MEDIUM = 40;
const SUPPORTED_ECOSYSTEMS = new Set(["npm"]);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type StoredContributorSignals = ContributorSignals & {
  hasTrustedPublisher: boolean | null;
};

type UpsertedVersion = {
  packageVersionId: string;
  version: string;
  publishedAt: Date;
  publisher: string | null;
  maintainers: string[];
  hasInstallScripts: boolean;
  hasAttestation: boolean;
  rawPayloadJson?: string | null;
};

type NormalizedManifestVersion = ContributorManifestVersion & {
  publishedAtDate: Date;
};

type ContributorFactQuality = {
  historyComplete: boolean | null;
  oldestIncludedPublishedAt: Date | null;
  observedAt: Date | null;
};

export function contributorIngestionConfigFromConnectors(
  connectors: RegisteredConnector[],
): ContributorConnectorConfig | null {
  const connector = connectors.find(isContributorConnectorRegistered);
  if (!connector) return null;
  return connector.config instanceof ContributorConnectorConfig
    ? connector.config
    : new ContributorConnectorConfig();
}

export async function ingestContributorMetadata(input: {
  event: ContributorManifestEvent;
  database: DB;
  config: ContributorConnectorConfig;
}): Promise<void> {
  if (!input.config.enabled) return;

  const ecosystem = canonicalizeEcosystem(input.event.ecosystem);
  if (!SUPPORTED_ECOSYSTEMS.has(ecosystem)) return;

  const packageName = canonicalizePackageName(ecosystem, input.event.package);
  const requestedVersion = input.event.requestedVersion
    ? canonicalizePackageVersion(input.event.requestedVersion)
    : null;
  const latestVersionFromEvent = input.event.latestVersion
    ? canonicalizePackageVersion(input.event.latestVersion)
    : null;
  const observedAt = parseRequiredDate(input.event.extractedAt);
  if (!observedAt) return;

  const latestPublishedAt = parseNullableDate(input.event.latestPublishedAt);
  const oldestIncludedPublishedAtFromEvent = parseNullableDate(
    input.event.oldestIncludedPublishedAt,
  );
  const inputVersions = normalizeManifestVersions(input.event.versions);
  if (inputVersions.length === 0) return;

  const latestVersion = [...inputVersions].sort(
    (a, b) => b.publishedAtDate.getTime() - a.publishedAtDate.getTime(),
  )[0];

  await input.database.transaction(async (tx) => {
    const packageRow = await upsertPackageIdentity(tx, {
      ecosystem,
      packageName,
      observedAt,
    });

    const upsertedVersions: UpsertedVersion[] = [];
    for (const version of inputVersions) {
      const canonicalVersion = canonicalizePackageVersion(version.version);
      const packageVersion = await upsertPackageVersion(tx, {
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

    const oldestIncludedPublishedAt = upsertedVersions[0]?.publishedAt ?? null;
    const latestPackageVersionId =
      upsertedVersions.find(
        (version) => version.version === latestVersion.version,
      )?.packageVersionId ?? null;

    await updatePackageMetadata(tx, {
      packageId: packageRow.id,
      latestPackageVersionId,
      latestPublishedAt: latestVersion.publishedAtDate,
      observedAt,
    });

    await upsertContributorPackageFacts(tx, {
      packageId: packageRow.id,
      fingerprint:
        input.event.packageMetadataFingerprint ?? input.event.fingerprint,
      historyComplete: input.event.historyComplete,
      oldestIncludedPublishedAt:
        oldestIncludedPublishedAtFromEvent ?? oldestIncludedPublishedAt,
      observedAt,
    });

    await upsertContributorReleaseFacts(tx, {
      event: input.event,
      ecosystem,
      packageName,
      packageId: packageRow.id,
      observedAt,
      requestedVersion,
      upsertedVersions,
      config: input.config,
    });

    if (latestVersionFromEvent && latestPublishedAt) {
      const latestRow = upsertedVersions.find(
        (version) => version.version === latestVersionFromEvent,
      );

      if (!latestRow) {
        const packageVersion = await upsertPackageVersion(tx, {
          packageId: packageRow.id,
          version: latestVersionFromEvent,
          publishedAt: latestPublishedAt,
          observedAt,
        });

        await updatePackageMetadata(tx, {
          packageId: packageRow.id,
          latestPackageVersionId: packageVersion.id,
          latestPublishedAt,
          observedAt,
        });
      }
    }
  });
}

async function updatePackageMetadata(
  tx: Tx,
  input: {
    packageId: string;
    latestPackageVersionId: string | null;
    latestPublishedAt: Date | null;
    observedAt: Date;
  },
): Promise<void> {
  const [current] = await tx
    .select({
      latestPublishedAt: package_versions.published_at,
    })
    .from(packages)
    .leftJoin(
      package_versions,
      eq(package_versions.id, packages.latest_package_version_id),
    )
    .where(eq(packages.id, input.packageId))
    .limit(1);

  const shouldUpdateLatest =
    input.latestPackageVersionId !== null &&
    (current?.latestPublishedAt === null ||
      current?.latestPublishedAt === undefined ||
      input.latestPublishedAt === null ||
      input.latestPublishedAt.getTime() >= current.latestPublishedAt.getTime());

  await tx
    .update(packages)
    .set({
      ...(shouldUpdateLatest
        ? { latest_package_version_id: input.latestPackageVersionId }
        : {}),
      last_metadata_seen_at: sql`GREATEST(COALESCE(${packages.last_metadata_seen_at}, ${input.observedAt}), ${input.observedAt})`,
      updated_at: sql`NOW()`,
    })
    .where(eq(packages.id, input.packageId));
}

function normalizeManifestVersions(
  versions: ContributorManifestVersion[],
): NormalizedManifestVersion[] {
  return versions
    .map(
      (
        version,
      ): ContributorManifestVersion & { publishedAtDate: Date | null } => ({
        ...version,
        publishedAtDate: parseRequiredDate(version.publishedAt),
      }),
    )
    .filter(
      (version): version is NormalizedManifestVersion =>
        version.publishedAtDate !== null,
    )
    .sort((a, b) => a.publishedAtDate.getTime() - b.publishedAtDate.getTime());
}

async function upsertContributorPackageFacts(
  tx: Tx,
  input: {
    packageId: string;
    fingerprint: string | null | undefined;
    historyComplete: boolean;
    oldestIncludedPublishedAt: Date | null;
    observedAt: Date;
  },
): Promise<void> {
  const [existing] = await tx
    .select({
      historyComplete: contributor_package_facts.history_complete,
      oldestIncludedPublishedAt:
        contributor_package_facts.oldest_included_published_at,
      observedAt: contributor_package_facts.observed_at,
    })
    .from(contributor_package_facts)
    .where(eq(contributor_package_facts.package_id, input.packageId))
    .limit(1);

  if (
    existing &&
    !shouldReplaceContributorFacts(
      {
        historyComplete: input.historyComplete,
        oldestIncludedPublishedAt: input.oldestIncludedPublishedAt,
        observedAt: input.observedAt,
      },
      existing,
    )
  ) {
    return;
  }

  await tx
    .insert(contributor_package_facts)
    .values({
      package_id: input.packageId,
      fingerprint: input.fingerprint ?? null,
      history_complete: input.historyComplete,
      oldest_included_published_at: input.oldestIncludedPublishedAt,
      observed_at: input.observedAt,
      updated_at: sql`NOW()`,
    })
    .onConflictDoUpdate({
      target: [contributor_package_facts.package_id],
      set: {
        fingerprint: input.fingerprint ?? null,
        history_complete: input.historyComplete,
        oldest_included_published_at: input.oldestIncludedPublishedAt,
        observed_at: input.observedAt,
        updated_at: sql`NOW()`,
      },
    });
}

async function upsertContributorReleaseFacts(
  tx: Tx,
  input: {
    event: ContributorManifestEvent;
    ecosystem: string;
    packageName: string;
    packageId: string;
    observedAt: Date;
    requestedVersion: string | null;
    upsertedVersions: UpsertedVersion[];
    config: ContributorConnectorConfig;
  },
): Promise<void> {
  const seenPublishers = new Map<string, number>();
  let priorVersionPublisher: string | null = null;
  let priorMaintainers: string[] = [];
  const firstPublishedAt =
    input.upsertedVersions[0]?.publishedAt ?? input.observedAt;
  const scorer = new ContributorScorer();

  for (const [index, version] of input.upsertedVersions.entries()) {
    const addedMaintainers = difference(version.maintainers, priorMaintainers);
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
      index === 0 ? null : !sameMembers(version.maintainers, priorMaintainers);
    const releaseVelocity7d = countVersionsInWindow(
      input.upsertedVersions,
      version.publishedAt,
      7,
    );
    const releaseVelocity30d = countVersionsInWindow(
      input.upsertedVersions,
      version.publishedAt,
      30,
    );
    const isRequestedVersion =
      input.requestedVersion !== null &&
      version.version === input.requestedVersion;
    const sliceFingerprint = isRequestedVersion
      ? (input.event.sliceFingerprint ?? null)
      : null;
    const sliceObservedAt =
      isRequestedVersion && input.event.sliceFingerprint
        ? input.observedAt
        : null;

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
      historyComplete: input.event.historyComplete,
    };

    const releaseValues = {
      published_at: version.publishedAt,
      source_kind: "npm_manifest",
      source_payload_version: "1",
      source_payload: parseRawPayload(version.rawPayloadJson, {
        ecosystem: input.ecosystem,
        package: input.packageName,
        version: version.version,
        published_at: version.publishedAt.toISOString(),
        publisher: version.publisher,
        maintainers: version.maintainers,
        scripts: { has_install_scripts: version.hasInstallScripts },
        provenance: { has_attestation: version.hasAttestation },
      }),
      source_observed_at: input.observedAt,
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
        index > 0 ? input.upsertedVersions[index - 1]?.packageVersionId : null,
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
      history_complete: input.event.historyComplete,
      contributor_slice_fingerprint: sliceFingerprint,
      contributor_slice_observed_at: sliceObservedAt,
      observed_at: input.observedAt,
      updated_at: sql`NOW()`,
    };

    const [existingRelease] = await tx
      .select({
        historyComplete: contributor_release_facts.history_complete,
        oldestIncludedPublishedAt:
          contributor_release_facts.first_published_at_for_package,
        observedAt: contributor_release_facts.observed_at,
      })
      .from(contributor_release_facts)
      .where(
        eq(
          contributor_release_facts.package_version_id,
          version.packageVersionId,
        ),
      )
      .limit(1);

    if (
      existingRelease &&
      !shouldReplaceContributorFacts(
        {
          historyComplete: input.event.historyComplete,
          oldestIncludedPublishedAt: firstPublishedAt,
          observedAt: input.observedAt,
        },
        existingRelease,
      )
    ) {
      if (version.publisher) {
        seenPublishers.set(
          version.publisher,
          (seenPublishers.get(version.publisher) ?? 0) + 1,
        );
      }
      priorVersionPublisher = version.publisher;
      priorMaintainers = version.maintainers;
      continue;
    }

    await tx
      .insert(contributor_release_facts)
      .values({
        package_version_id: version.packageVersionId,
        ...releaseValues,
      })
      .onConflictDoUpdate({
        target: [contributor_release_facts.package_version_id],
        set: {
          ...releaseValues,
          contributor_slice_fingerprint:
            sliceFingerprint ??
            sql`${contributor_release_facts.contributor_slice_fingerprint}`,
          contributor_slice_observed_at:
            sliceObservedAt ??
            sql`${contributor_release_facts.contributor_slice_observed_at}`,
        },
      });

    const scored = scorer.score(storedSignals);
    await upsertCachedResult(
      tx as unknown as DB,
      contributorCacheConnector(input.config),
      {
        id: `${CONTRIBUTOR_CONNECTOR_ID}:${version.packageVersionId}`,
        kind: "artifact_request",
        packageId: input.packageId,
        packageVersionId: version.packageVersionId,
        ecosystem: input.ecosystem,
        packageName: input.packageName,
        version: version.version,
        source: "proxy",
        observedAt: input.observedAt.toISOString(),
      } satisfies ConnectorArtifactEvent,
      scoreToConnectorResult(
        scored,
        scoreToTier(scored.score),
        versionAgeTtlSeconds(version.publishedAt, input.config),
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
}

export function shouldReplaceContributorFacts(
  incoming: ContributorFactQuality,
  existing: ContributorFactQuality,
): boolean {
  if (existing.historyComplete !== true && incoming.historyComplete === true) {
    return true;
  }
  if (existing.historyComplete === true && incoming.historyComplete !== true) {
    return false;
  }

  const incomingOldest = incoming.oldestIncludedPublishedAt?.getTime() ?? null;
  const existingOldest = existing.oldestIncludedPublishedAt?.getTime() ?? null;
  if (incomingOldest !== null && existingOldest === null) {
    return true;
  }
  if (incomingOldest === null && existingOldest !== null) {
    return false;
  }
  if (
    incomingOldest !== null &&
    existingOldest !== null &&
    incomingOldest !== existingOldest
  ) {
    return incomingOldest < existingOldest;
  }

  const incomingObserved = incoming.observedAt?.getTime() ?? null;
  const existingObserved = existing.observedAt?.getTime() ?? null;
  if (incomingObserved === null) {
    return existingObserved === null;
  }
  if (existingObserved === null) {
    return true;
  }
  return incomingObserved >= existingObserved;
}

function contributorCacheConnector(
  config: ContributorConnectorConfig,
): PackageIntelligenceConnector {
  return {
    id: CONTRIBUTOR_CONNECTOR_ID,
    config,
  } as unknown as PackageIntelligenceConnector;
}

async function upsertPackageIdentity(
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

async function upsertPackageVersion(
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
    // Invalid connector payloads fall back to the normalized manifest shape.
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
