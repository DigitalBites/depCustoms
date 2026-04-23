import { describe, expect, it } from "vitest";

import { parseOsvResponse } from "../../connectors/osv/parse.js";

describe("parseOsvResponse", () => {
  it("builds vulnerability summary metadata alongside findings", () => {
    const result = parseOsvResponse(
      {
        vulns: [
          {
            id: "OSV-1",
            summary: "Prototype pollution",
            severity: [
              {
                type: "CVSS_V3",
                score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:L",
              },
            ],
            affected: [
              {
                package: { ecosystem: "npm", name: "lodash" },
                ranges: [
                  {
                    type: "SEMVER",
                    events: [{ introduced: "0" }, { fixed: "4.17.21" }],
                  },
                ],
              },
            ],
            published: "2026-04-01T00:00:00Z",
          },
        ],
      },
      "lodash",
      "npm",
      "4.17.15",
    );

    expect(result.summary).toEqual({
      vulnerability: {
        maxSeverity: "HIGH",
        findingCount: 1,
        fixAvailable: true,
        bestFixVersion: "4.17.21",
        severityCounts: {
          critical: 0,
          high: 1,
          medium: 0,
          low: 0,
        },
      },
    });
    expect(result.findings).toEqual([
      expect.objectContaining({
        findingId: "OSV-1",
        severity: "HIGH",
        title: "Prototype pollution",
      }),
    ]);
  });
});
