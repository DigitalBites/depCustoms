import { describe, expect, it } from "vitest";

import { ContributorConnector } from "../../connectors/contributor/index.js";
import { ContributorConnectorConfig } from "../../connectors/contributor/config.js";
import { OsvConnector } from "../../connectors/osv/index.js";
import { OsvConnectorConfig } from "../../connectors/osv/config.js";

describe("connector presentation", () => {
  it("builds a generic OSV presentation from vulnerability summary data", () => {
    const connector = new OsvConnector(new OsvConnectorConfig());

    const presentation = connector.buildPresentation?.(
      {
        findings: [
          {
            findingId: "OSV-1",
            severity: "HIGH",
            title: "Prototype pollution",
            publishedAt: new Date("2026-04-01T00:00:00Z"),
            attributes: {},
          },
        ],
        summary: {
          vulnerability: {
            maxSeverity: "HIGH",
            findingCount: 2,
            fixAvailable: true,
            bestFixVersion: "4.17.21",
          },
        },
      },
      {
        connectorKey: "osv",
        entityType: "artifact",
        packageId: "pkg-1",
        packageVersionId: "pkgver-1",
        ecosystem: "npm",
        packageName: "lodash",
        version: "4.17.15",
        displayName: "npm:lodash@4.17.15",
        fields: {},
        meta: {
          status: "ok",
          responseTimeMs: 12,
          cacheAgeHours: null,
          isCacheHit: false,
        },
        observedAt: new Date("2026-04-23T00:00:00Z").toISOString(),
      },
    );

    expect(presentation).toMatchObject({
      summary: {
        status: "ok",
        headline: "2 findings detected",
        disposition: "blocked",
        badges: expect.arrayContaining([
          expect.objectContaining({ label: "HIGH severity" }),
          expect.objectContaining({ label: "Fix available" }),
        ]),
        keyFacts: expect.arrayContaining([
          { label: "Findings", value: "2" },
          { label: "Best fix version", value: "4.17.21" },
        ]),
      },
      findings: [
        {
          findingId: "OSV-1",
          severity: "HIGH",
          title: "Prototype pollution",
          publishedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("builds a contributor presentation with score-oriented summary facts", () => {
    const connector = new ContributorConnector(
      new ContributorConnectorConfig(),
    );

    const presentation = connector.buildPresentation?.(
      {
        findings: [
          {
            findingId: "contributor_signals",
            severity: "MEDIUM",
            title: "Contributor risk score medium",
            publishedAt: null,
            attributes: {
              publisher: "alice",
              new_maintainer_count: 1,
              release_velocity_30d: 2,
            },
          },
        ],
        summary: {
          risk: {
            tier: "MEDIUM",
            score: 70,
          },
          findings: {
            count: 1,
          },
          remediation: {
            available: false,
            best: null,
          },
        },
      },
      {
        connectorKey: "contributor",
        entityType: "artifact",
        packageId: "pkg-1",
        packageVersionId: "pkgver-1",
        ecosystem: "npm",
        packageName: "lodash",
        version: "4.17.15",
        displayName: "npm:lodash@4.17.15",
        fields: {},
        meta: {
          status: "cache_hit",
          responseTimeMs: 0,
          cacheAgeHours: 2,
          isCacheHit: true,
        },
        observedAt: new Date("2026-04-23T00:00:00Z").toISOString(),
      },
    );

    expect(presentation).toMatchObject({
      summary: {
        status: "cache_hit",
        headline: "Contributor risk score 70",
        disposition: "warning",
        score: 70,
        badges: expect.arrayContaining([
          expect.objectContaining({ label: "Cache hit" }),
          expect.objectContaining({ label: "MEDIUM tier" }),
        ]),
        keyFacts: expect.arrayContaining([
          { label: "Risk score", value: "70" },
          { label: "Publisher", value: "alice" },
          { label: "New maintainers", value: "1" },
          { label: "Releases (30d)", value: "2" },
        ]),
      },
      findings: [
        {
          findingId: "contributor_signals",
          severity: "MEDIUM",
          title: "Contributor risk score medium",
          publishedAt: null,
        },
      ],
    });
  });
});
