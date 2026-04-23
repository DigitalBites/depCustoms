import { beforeEach, describe, expect, it, vi } from "vitest";

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
import {
  ContributorConnector,
  CONTRIBUTOR_FACTS_UNAVAILABLE_ERROR,
} from "../../connectors/contributor/index.js";
import { ContributorConnectorConfig } from "../../connectors/contributor/config.js";
import { q } from "../helpers/fakes.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.select).mockReturnValue(q([]) as never);
});

describe("ContributorConnector.fetchSignals", () => {
  it("throws unavailable when no exact-version contributor facts exist", async () => {
    const connector = new ContributorConnector(
      new ContributorConnectorConfig(),
    );

    await expect(
      connector.fetchSignals("npm", "lodash", "4.17.15"),
    ).rejects.toThrow(CONTRIBUTOR_FACTS_UNAVAILABLE_ERROR);
  });

  it("returns an empty result for unsupported ecosystems", async () => {
    const connector = new ContributorConnector(
      new ContributorConnectorConfig(),
    );

    await expect(
      connector.fetchSignals("pypi", "requests", "2.32.0"),
    ).resolves.toMatchObject({
      summary: {
        vulnerability: {
          maxSeverity: "NONE",
          findingCount: 0,
          fixAvailable: false,
          bestFixVersion: null,
        },
      },
      findings: [],
    });
  });

  it("returns a populated connector snapshot for scored results", () => {
    const connector = new ContributorConnector(
      new ContributorConnectorConfig(),
    );

    const snapshot = connector.normalizeToSnapshot(
      {
        summary: {
          vulnerability: {
            maxSeverity: "HIGH",
            findingCount: 82,
            fixAvailable: false,
            bestFixVersion: null,
          },
        },
        findings: [
          {
            findingId: "contrib-risk",
            severity: "HIGH",
            title: "Contributor risk score high",
            publishedAt: null,
            attributes: {
              score_model_version: "2026-04-01",
              publisher_seen_before_package: false,
              publisher_seen_count_before: 0,
              publisher_matches_prior_version: false,
              maintainer_set_changed: true,
              new_maintainer_count: 1,
              removed_maintainer_count: 0,
              maintainer_count: 2,
              has_install_scripts: true,
              has_provenance: true,
              has_trusted_publisher: false,
              release_velocity_7d: 1,
              release_velocity_30d: 2,
              history_complete: false,
            },
          },
        ],
      },
      {
        ecosystem: "npm",
        pkg: "lodash",
        version: "4.17.15",
        isCacheHit: false,
        responseTimeMs: 12,
        cacheAgeHours: null,
      },
    );

    expect(snapshot).toMatchObject({
      connectorKey: "contributor",
      entityType: "artifact",
      entityId: "npm:lodash:4.17.15",
      fields: expect.objectContaining({
        contributor_risk_score: 82,
        score_tier: "HIGH",
        maintainer_set_changed: true,
        has_install_scripts: true,
      }),
      meta: expect.objectContaining({
        status: "ok",
        responseTimeMs: 12,
        isCacheHit: false,
      }),
    });
  });

  it("returns an empty snapshot payload when the connector failed", () => {
    const connector = new ContributorConnector(
      new ContributorConnectorConfig(),
    );

    const snapshot = connector.normalizeToSnapshot(
      null,
      {
        ecosystem: "npm",
        pkg: "lodash",
        version: "4.17.15",
        isCacheHit: false,
        responseTimeMs: 9,
        cacheAgeHours: null,
      },
      "background_pending",
      "response_timeout",
    );

    expect(snapshot.fields).toEqual({});
    expect(snapshot.meta).toMatchObject({
      status: "background_pending",
      errorCode: "response_timeout",
    });
  });

  it("loads stored contributor facts and computes a medium-risk result", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        {
          publishedAt: new Date("2026-04-15T00:00:00Z"),
          publisher: "alice",
          publisherSeenBeforePackage: false,
          publisherSeenCountBefore: 0,
          publisherMatchesPriorVersion: false,
          priorVersionPublisher: "bob",
          maintainerSetChanged: true,
          newMaintainerCount: 1,
          removedMaintainerCount: 0,
          maintainerCount: 2,
          hasInstallScripts: false,
          hasProvenance: true,
          hasTrustedPublisher: false,
          releaseVelocity7d: 2,
          releaseVelocity30d: 2,
          historyComplete: true,
        },
      ]) as any,
    );

    const connector = new ContributorConnector(
      new ContributorConnectorConfig(),
    );

    await expect(
      connector.fetchSignals("npm", "lodash", "4.17.15"),
    ).resolves.toMatchObject({
      ttlSeconds: 86400,
      summary: {
        vulnerability: {
          maxSeverity: "MEDIUM",
          findingCount: 70,
          fixAvailable: false,
          bestFixVersion: null,
        },
      },
      findings: [
        expect.objectContaining({
          findingId: "contributor_signals",
          severity: "MEDIUM",
          attributes: expect.objectContaining({
            publisher: "alice",
            score_model_version: "3.0",
            history_complete: true,
          }),
        }),
      ],
    });
  });

  it("exposes the contributor field catalog and finding schema", () => {
    const connector = new ContributorConnector(
      new ContributorConnectorConfig(),
    );

    expect(connector.getFieldCatalog()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldKey: "contributor_risk_score",
          canonicalRef: "source.contributor.contributor_risk_score",
          dataType: "integer",
        }),
        expect.objectContaining({
          fieldKey: "_meta.status",
          enumValues: expect.arrayContaining(["ok", "background_pending"]),
        }),
      ]),
    );

    expect(connector.getFindingSchema()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "score", dataType: "integer" }),
        expect.objectContaining({ key: "publisher", display: "code" }),
        expect.objectContaining({
          key: "has_install_scripts",
          display: "badge",
        }),
      ]),
    );
  });

  it("skips prefetch processing for unsupported ecosystems", async () => {
    const connector = new ContributorConnector(
      new ContributorConnectorConfig(),
    );
    const fakeDb = { transaction: vi.fn() };

    await connector.processPrefetchEvent(
      {
        ecosystem: "pypi",
        package: "requests",
        extractedAt: "2026-04-01T00:00:00Z",
        fingerprint: null,
        latestVersion: "2.32.0",
        latestPublishedAt: "2026-04-01T00:00:00Z",
        historyComplete: true,
        oldestIncludedPublishedAt: "2026-04-01T00:00:00Z",
        versions: [],
      },
      fakeDb as any,
    );

    expect(fakeDb.transaction).not.toHaveBeenCalled();
  });

  it("skips prefetch processing when extracted timestamps or versions are invalid", async () => {
    const connector = new ContributorConnector(
      new ContributorConnectorConfig(),
    );
    const fakeDb = { transaction: vi.fn() };

    await connector.processPrefetchEvent(
      {
        ecosystem: "npm",
        package: "lodash",
        extractedAt: "not-a-date",
        fingerprint: null,
        latestVersion: "4.17.15",
        latestPublishedAt: "2026-04-01T00:00:00Z",
        historyComplete: true,
        oldestIncludedPublishedAt: "2026-04-01T00:00:00Z",
        versions: [],
      },
      fakeDb as any,
    );

    await connector.processPrefetchEvent(
      {
        ecosystem: "npm",
        package: "lodash",
        extractedAt: "2026-04-01T00:00:00Z",
        fingerprint: null,
        latestVersion: "4.17.15",
        latestPublishedAt: "2026-04-01T00:00:00Z",
        historyComplete: true,
        oldestIncludedPublishedAt: "2026-04-01T00:00:00Z",
        versions: [
          {
            version: "4.17.15",
            publishedAt: "not-a-date",
            publisher: "alice",
            maintainers: ["alice"],
            hasInstallScripts: false,
            hasAttestation: true,
          },
        ],
      },
      fakeDb as any,
    );

    expect(fakeDb.transaction).not.toHaveBeenCalled();
  });
});
