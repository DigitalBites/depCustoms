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

vi.mock("../../db/index.js", () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from "../../db/index.js";
import {
  listProjectContributorPackages,
  listTenantContributorPackageProjects,
  listTenantContributorPackages,
  listTenantContributorPublishers,
  loadProjectContributorSummary,
  loadTenantContributorSummary,
} from "../../features/security/contributor-package-list-queries.js";
import { TEST_PROJECT_ID, TEST_TENANT_ID } from "../helpers/fakes.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.execute).mockReset();
});

describe("contributor query helpers", () => {
  it("lists project contributor packages and computes total from the first row", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([
      {
        ecosystem: "npm",
        name: "lodash",
        version: "4.17.15",
        version_published_at: "2026-04-01T00:00:00Z",
        score: 82,
        score_tier: "HIGH",
        publisher: "alice",
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
        release_velocity_7d: 2,
        release_velocity_30d: 3,
        history_complete: true,
        raw_factors: { publisher_changed: 20 },
        last_scored_at: "2026-04-02T00:00:00Z",
        last_pulled_at: "2026-04-03T00:00:00Z",
        latest_version: "4.17.21",
        total_count: "2",
      },
    ] as any);

    const result = await listProjectContributorPackages(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      {
        scoreTier: "HIGH",
        minScore: 80,
        limit: 10,
        offset: 0,
      },
    );

    expect(result.total).toBe(2);
    expect(result.packages[0]).toEqual(
      expect.objectContaining({
        name: "lodash",
        score_tier: "HIGH",
        publisher: "alice",
      }),
    );
  });

  it("lists tenant contributor packages and returns zero total for empty rows", async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce([
        {
          package_id: "pkg-1",
          ecosystem: "npm",
          name: "react",
          version: "18.3.0",
          version_published_at: "2026-04-01T00:00:00Z",
          score: 45,
          score_tier: "MEDIUM",
          publisher: "bob",
          publisher_seen_before_package: true,
          publisher_seen_count_before: 1,
          publisher_matches_prior_version: true,
          maintainer_set_changed: false,
          new_maintainer_count: 0,
          removed_maintainer_count: 0,
          maintainer_count: 3,
          has_install_scripts: false,
          has_provenance: true,
          has_trusted_publisher: false,
          release_velocity_7d: 1,
          release_velocity_30d: 2,
          history_complete: true,
          raw_factors: {},
          last_scored_at: "2026-04-02T00:00:00Z",
          last_pulled_at: "2026-04-03T00:00:00Z",
          latest_version: "18.3.0",
          total_count: "1",
        },
      ] as any)
      .mockResolvedValueOnce([] as any);

    const scoped = await listTenantContributorPackages(
      TEST_TENANT_ID,
      ["p-1"],
      {
        minScore: 40,
        limit: 10,
        offset: 0,
      },
    );
    expect(scoped.total).toBe(1);
    expect(scoped.packages[0]?.package_id).toBe("pkg-1");

    const empty = await listTenantContributorPackages(TEST_TENANT_ID, [], {
      limit: 10,
      offset: 0,
    });
    expect(empty).toEqual({ packages: [], total: 0 });
  });

  it("loads project and tenant contributor summaries", async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce([
        {
          total_scanned: "4",
          not_scanned_count: "1",
          high_risk_count: "1",
          medium_risk_count: "1",
          low_risk_count: "1",
          clean_count: "1",
          new_maintainer_count: "2",
          first_time_publisher_count: "1",
          publisher_change_count: "1",
          install_scripts_count: "1",
          last_scored_at: "2026-04-01T00:00:00Z",
        },
      ] as any)
      .mockResolvedValueOnce([
        {
          total_scanned: "6",
          not_scanned_count: "2",
          high_risk_count: "2",
          medium_risk_count: "1",
          low_risk_count: "2",
          clean_count: "1",
          new_maintainer_count: "3",
          first_time_publisher_count: "2",
          publisher_change_count: "1",
          install_scripts_count: "2",
          last_scored_at: "2026-04-04T00:00:00Z",
        },
      ] as any)
      .mockResolvedValueOnce([
        {
          project_id: "p-1",
          project_name: "Alpha",
          total_scanned: "3",
          high_risk_count: "1",
          medium_risk_count: "1",
          low_risk_count: "0",
          clean_count: "1",
        },
      ] as any);

    await expect(
      loadProjectContributorSummary(TEST_PROJECT_ID, TEST_TENANT_ID),
    ).resolves.toEqual(
      expect.objectContaining({
        total_scanned: "4",
        install_scripts_count: "1",
      }),
    );

    await expect(
      loadTenantContributorSummary(TEST_TENANT_ID, ["p-1"]),
    ).resolves.toEqual({
      summary: expect.objectContaining({
        total_scanned: "6",
        first_time_publisher_count: "2",
      }),
      byProject: [
        expect.objectContaining({
          project_id: "p-1",
          project_name: "Alpha",
        }),
      ],
    });
  });

  it("lists tenant contributor publishers and package-project mappings", async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce([
        {
          ecosystem: "npm",
          publisher_name: "alice",
          package_count: 2,
          first_time_publisher_count: 1,
          continuity_break_count: 1,
          last_seen_at: "2026-04-05T00:00:00Z",
          total_count: "1",
        },
      ] as any)
      .mockResolvedValueOnce([
        {
          package_id: "pkg-1",
          project_id: "p-1",
          project_name: "Alpha",
        },
      ] as any);

    const publishers = await listTenantContributorPublishers(TEST_TENANT_ID, {
      ecosystem: "npm",
      onlyFirstTime: true,
      limit: 10,
      offset: 0,
    });
    expect(publishers.total).toBe(1);
    expect(publishers.publishers[0]).toEqual(
      expect.objectContaining({
        publisher_name: "alice",
        package_count: 2,
      }),
    );

    expect(
      await listTenantContributorPackageProjects(TEST_TENANT_ID, [], null),
    ).toEqual([]);

    const rows = await listTenantContributorPackageProjects(
      TEST_TENANT_ID,
      ["pkg-1"],
      ["p-1"],
    );
    expect(rows).toEqual([
      {
        package_id: "pkg-1",
        project_id: "p-1",
        project_name: "Alpha",
      },
    ]);
  });
});
