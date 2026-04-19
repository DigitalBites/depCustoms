import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/index.js");
vi.mock("../../connectors/runtime.js", () => ({
  getConnectors: vi.fn(),
}));

import { db } from "../../db/index.js";
import { getConnectors } from "../../connectors/runtime.js";
import { loadViolationFindings } from "../../features/violations/finding-details.js";
import { q, TEST_PROJECT_ID, TEST_TENANT_ID } from "../helpers/fakes.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadViolationFindings", () => {
  it("enriches contributor findings from connector cache and exposes the contributor schema", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(
        q([
          {
            id: "pf-1",
            project_id: TEST_PROJECT_ID,
            tenant_id: TEST_TENANT_ID,
            connector_key: "contributor",
            entity_id: "npm:pkg:1.1.0",
            finding_id: "contributor_signals",
            severity: "HIGH",
            title: "Contributor risk score: 82",
            status: "open",
            status_note: null,
            first_seen_at: new Date("2026-04-15T00:00:00Z"),
            last_seen_at: new Date("2026-04-15T00:00:00Z"),
          },
        ]) as any,
      )
      .mockReturnValueOnce(
        q([
          {
            data: {
              findings: [
                {
                  id: "contributor_signals",
                  severity: "HIGH",
                  title: "Contributor risk score: 82",
                  published_at: "2026-04-14T00:00:00Z",
                  attributes: {
                    publisher: "bob",
                    publisher_seen_before_package: false,
                    publisher_matches_prior_version: false,
                    new_maintainer_count: 1,
                    has_install_scripts: true,
                    release_velocity_7d: 2,
                  },
                },
              ],
            },
          },
        ]) as any,
      );

    vi.mocked(getConnectors).mockReturnValue([
      {
        id: "contributor",
        getFindingSchema: () => [
          {
            key: "publisher_seen_before_package",
            label: "Publisher Seen Before",
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
            key: "has_install_scripts",
            label: "Install Scripts",
            dataType: "boolean",
            display: "badge",
          },
        ],
      } as any,
    ]);

    const result = await loadViolationFindings(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      "npm:pkg:1.1.0",
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      connector_key: "contributor",
      finding_id: "contributor_signals",
      advisory: {
        published_at: "2026-04-14T00:00:00Z",
        attributes: expect.objectContaining({
          publisher: "bob",
          publisher_seen_before_package: false,
          publisher_matches_prior_version: false,
          new_maintainer_count: 1,
          has_install_scripts: true,
        }),
      },
    });
    expect(result.findingSchemas.contributor).toEqual([
      expect.objectContaining({
        key: "publisher_seen_before_package",
      }),
      expect.objectContaining({
        key: "new_maintainer_count",
      }),
      expect.objectContaining({
        key: "has_install_scripts",
      }),
    ]);
  });
});
