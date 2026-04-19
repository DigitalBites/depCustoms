import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContributorScorer,
  SCORE_MODEL_VERSION,
  type ContributorSignals,
} from "../../connectors/contributor/scorer.js";

const baseSignals: ContributorSignals = {
  version: "1.2.3",
  publishedAt: new Date("2026-04-10T00:00:00Z"),
  publisher: "alice",
  publisherSeenBeforePackage: false,
  publisherSeenCountBefore: 0,
  publisherMatchesPriorVersion: false,
  priorVersionPublisher: "bob",
  maintainerSetChanged: true,
  newMaintainerCount: 3,
  removedMaintainerCount: 2,
  maintainerCount: 4,
  hasInstallScripts: true,
  hasProvenance: false,
  hasTrustedPublisher: false,
  releaseVelocity7d: 5,
  releaseVelocity30d: 12,
  historyComplete: true,
};

describe("ContributorScorer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T00:00:00Z"));
  });

  it("scores fresh risky releases and exposes all non-null signals", () => {
    const result = new ContributorScorer().score(baseSignals);

    expect(result.score).toBe(100);
    expect(result.scoreModelVersion).toBe(SCORE_MODEL_VERSION);
    expect(result.rawFactors).toEqual({
      first_time_publisher: 25,
      publisher_changed: 20,
      maintainer_set_changed: 12,
      new_maintainers: 24,
      removed_maintainers: 8,
      install_scripts: 25,
      missing_provenance: 10,
      release_velocity_7d: 12,
      release_velocity_30d: 8,
      trusted_publisher_reduction: 0,
      age_decay_multiplier: 1,
    });
    expect(result.signalsAvailable).toEqual(
      expect.arrayContaining([
        "publisher",
        "publisherSeenBeforePackage",
        "publisherMatchesPriorVersion",
        "hasInstallScripts",
        "historyComplete",
      ]),
    );
  });

  it("applies age decay and trusted publisher reduction for old releases", () => {
    const result = new ContributorScorer().score({
      ...baseSignals,
      publishedAt: new Date("2025-03-01T00:00:00Z"),
      publisherSeenBeforePackage: true,
      publisherMatchesPriorVersion: true,
      maintainerSetChanged: false,
      newMaintainerCount: 1,
      removedMaintainerCount: 1,
      hasInstallScripts: false,
      hasProvenance: true,
      hasTrustedPublisher: true,
      releaseVelocity7d: 2,
      releaseVelocity30d: 8,
    });

    expect(result.rawFactors).toEqual({
      first_time_publisher: 0,
      publisher_changed: 0,
      maintainer_set_changed: 0,
      new_maintainers: 1,
      removed_maintainers: 0,
      install_scripts: 0,
      missing_provenance: 0,
      release_velocity_7d: 0,
      release_velocity_30d: 1,
      trusted_publisher_reduction: -10,
      age_decay_multiplier: 0.1,
    });
    expect(result.score).toBe(0);
  });

  it("keeps nullable signals out of signalsAvailable and rounds decayed factors", () => {
    const result = new ContributorScorer().score({
      ...baseSignals,
      publishedAt: new Date("2026-01-15T00:00:00Z"),
      publisher: null,
      publisherSeenBeforePackage: null,
      publisherSeenCountBefore: null,
      publisherMatchesPriorVersion: null,
      priorVersionPublisher: null,
      maintainerSetChanged: null,
      newMaintainerCount: null,
      removedMaintainerCount: null,
      maintainerCount: null,
      hasInstallScripts: false,
      hasProvenance: true,
      hasTrustedPublisher: false,
      releaseVelocity7d: 3,
      releaseVelocity30d: null,
      historyComplete: null,
    });

    expect(result.rawFactors).toEqual({
      first_time_publisher: 0,
      publisher_changed: 0,
      maintainer_set_changed: 0,
      new_maintainers: null,
      removed_maintainers: null,
      install_scripts: 0,
      missing_provenance: 0,
      release_velocity_7d: 4,
      release_velocity_30d: null,
      trusted_publisher_reduction: 0,
      age_decay_multiplier: 0.5,
    });
    expect(result.signalsAvailable).not.toContain("publisher");
    expect(result.signalsAvailable).not.toContain("newMaintainerCount");
    expect(result.signalsAvailable).toContain("releaseVelocity7d");
    expect(result.score).toBe(4.5);
  });
});
