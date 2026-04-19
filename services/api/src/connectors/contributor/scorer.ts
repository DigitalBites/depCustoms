export const SCORE_MODEL_VERSION = "3.0";

export interface ContributorSignals {
  version: string;
  publishedAt: Date;
  publisher: string | null;
  publisherSeenBeforePackage: boolean | null;
  publisherSeenCountBefore: number | null;
  publisherMatchesPriorVersion: boolean | null;
  priorVersionPublisher: string | null;
  maintainerSetChanged: boolean | null;
  newMaintainerCount: number | null;
  removedMaintainerCount: number | null;
  maintainerCount: number | null;
  hasInstallScripts: boolean | null;
  hasProvenance: boolean | null;
  hasTrustedPublisher: boolean | null;
  releaseVelocity7d: number | null;
  releaseVelocity30d: number | null;
  historyComplete: boolean | null;
}

export interface ScoredContributorSignals extends ContributorSignals {
  score: number;
  scoreModelVersion: string;
  rawFactors: Record<string, number | null>;
  signalsAvailable: string[];
}

export class ContributorScorer {
  score(signals: ContributorSignals): ScoredContributorSignals {
    const ageDecayMultiplier = contributorAgeDecayMultiplier(
      signals.publishedAt,
    );
    const rawFactors: Record<string, number | null> = {
      first_time_publisher: decayFactor(
        signals.publisherSeenBeforePackage === false ? 25 : 0,
        ageDecayMultiplier,
      ),
      publisher_changed: decayFactor(
        signals.publisherMatchesPriorVersion === false ? 20 : 0,
        ageDecayMultiplier,
      ),
      maintainer_set_changed: decayFactor(
        signals.maintainerSetChanged === true ? 12 : 0,
        ageDecayMultiplier,
      ),
      new_maintainers:
        signals.newMaintainerCount !== null
          ? decayFactor(
              Math.min(signals.newMaintainerCount * 8, 24),
              ageDecayMultiplier,
            )
          : null,
      removed_maintainers:
        signals.removedMaintainerCount !== null
          ? decayFactor(
              Math.min(signals.removedMaintainerCount * 4, 12),
              ageDecayMultiplier,
            )
          : null,
      install_scripts: signals.hasInstallScripts === true ? 25 : 0,
      missing_provenance: signals.hasProvenance === false ? 10 : 0,
      release_velocity_7d: decayFactor(
        velocityFactor(signals.releaseVelocity7d, [
          [5, 12],
          [3, 8],
          [2, 4],
        ]),
        ageDecayMultiplier,
      ),
      release_velocity_30d: decayFactor(
        velocityFactor(signals.releaseVelocity30d, [
          [12, 8],
          [8, 5],
        ]),
        ageDecayMultiplier,
      ),
      trusted_publisher_reduction:
        signals.hasTrustedPublisher === true ? -10 : 0,
      age_decay_multiplier: Number(ageDecayMultiplier.toFixed(2)),
    };

    const score = Math.max(
      0,
      Math.min(
        100,
        Object.values(rawFactors).reduce<number>(
          (sum, value) => sum + (value ?? 0),
          0,
        ),
      ),
    );

    const signalsAvailable = Object.entries(signals)
      .filter(([, value]) => value !== null)
      .map(([key]) => key);

    return {
      ...signals,
      score,
      scoreModelVersion: SCORE_MODEL_VERSION,
      rawFactors,
      signalsAvailable,
    };
  }
}

function contributorAgeDecayMultiplier(publishedAt: Date): number {
  const ageDays = (Date.now() - publishedAt.getTime()) / 86_400_000;
  if (ageDays <= 30) return 1;
  if (ageDays <= 90) return 0.75;
  if (ageDays <= 180) return 0.5;
  if (ageDays <= 365) return 0.25;
  return 0.1;
}

function decayFactor(value: number | null, multiplier: number): number | null {
  if (value === null) return null;
  return Math.round(value * multiplier);
}

function velocityFactor(
  value: number | null,
  thresholds: Array<[minimum: number, score: number]>,
): number | null {
  if (value === null) return null;
  for (const [minimum, score] of thresholds) {
    if (value >= minimum) return score;
  }
  return 0;
}
