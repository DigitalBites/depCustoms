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
    select: vi.fn(),
    selectDistinct: vi.fn(),
  },
}));

import { db } from "../../db/index.js";
import { q, TEST_PROJECT_ID, TEST_TENANT_ID } from "../helpers/fakes.js";
import { loadProjectSecuritySummaryRow } from "../../features/security/project-security-summary-query.js";
import {
  listProjectVulnerablePackages,
  listLegacyProjectVulnerablePackages,
} from "../../features/security/package-list-queries.js";
import { selectProjectPackagesForSync } from "../../features/security/connector-sync-selection.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.execute).mockReset();
  vi.mocked(db.select).mockReset();
  vi.mocked(db.selectDistinct).mockReset();
});

describe("security query helpers", () => {
  it("loads the project security summary row", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([
      {
        open_count: "5",
        suppressed_count: "2",
        critical_open_count: "1",
        high_open_count: "2",
        medium_open_count: "1",
        low_open_count: "1",
        oldest_open_at: "2026-04-01T00:00:00Z",
        blocks_30d: "8",
        blocks_7d: "3",
        blocks_prior_7d: "1",
        suppressions_count: "4",
        last_synced_at: new Date("2026-04-10T00:00:00Z"),
        new_findings: 2,
        synced_count: 7,
      },
    ] as any);

    const row = await loadProjectSecuritySummaryRow(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      new Date("2026-04-18T00:00:00Z"),
    );

    expect(row).toEqual(
      expect.objectContaining({
        open_count: "5",
        blocks_7d: "3",
        last_synced_at: new Date("2026-04-10T00:00:00Z"),
      }),
    );
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it("returns null when the project security summary query is empty", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([] as any);

    const row = await loadProjectSecuritySummaryRow(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
    );
    expect(row).toBeNull();
  });

  it("lists project vulnerable packages and computes total from the first row", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        {
          packageId: "pkg-1",
          cacheId: "cache-1",
          ecosystem: "npm",
          name: "lodash",
          version: "4.17.15",
          versionPublishedAt: "2026-03-01T00:00:00Z",
          maxSeverity: "HIGH",
          vulnCount: 2,
          fixAvailable: true,
          bestFixVersion: "4.17.21",
          latestVersion: "4.17.21",
          latestVersionPublishedAt: "2026-04-01T00:00:00Z",
          lastPulledAt: "2026-04-05T00:00:00Z",
          totalCount: "3",
        },
      ]) as any,
    );

    const result = await listProjectVulnerablePackages(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      0,
      10,
    );
    expect(result.total).toBe(3);
    expect(result.vulnPackages[0]).toEqual(
      expect.objectContaining({
        ecosystem: "npm",
        name: "lodash",
        maxSeverity: "HIGH",
      }),
    );
  });

  it("returns zero total when no vulnerable packages are found", async () => {
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any);

    const result = await listProjectVulnerablePackages(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      0,
      10,
    );
    expect(result).toEqual({ vulnPackages: [], total: 0 });
  });

  it("lists legacy project vulnerable packages", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        {
          packageId: "pkg-1",
          cacheId: "cache-1",
          ecosystem: "npm",
          name: "lodash",
          version: "4.17.15",
          totalCount: "2",
        },
      ]) as any,
    );

    const result = await listLegacyProjectVulnerablePackages(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      0,
      10,
    );
    expect(result.total).toBe(2);
    expect(result.vulnPackages).toHaveLength(1);
  });

  it("selects all project packages for sync when scope=all", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        { ecosystem: "npm", name: "lodash", version: "4.17.15" },
        { ecosystem: "npm", name: "react", version: "18.3.0" },
      ]) as any,
    );

    const packages = await selectProjectPackagesForSync(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      "osv",
      "all",
    );

    expect(packages).toEqual([
      { ecosystem: "npm", name: "lodash", version: "4.17.15" },
      { ecosystem: "npm", name: "react", version: "18.3.0" },
    ]);
  });

  it("filters sync selection down to vulnerable packages", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        { ecosystem: "npm", name: "lodash", version: "4.17.15" },
        { ecosystem: "npm", name: "react", version: "18.3.0" },
      ]) as any,
    );
    vi.mocked(db.selectDistinct).mockReturnValueOnce(
      q([{ ecosystem: "npm", name: "lodash", version: "4.17.15" }]) as any,
    );

    const packages = await selectProjectPackagesForSync(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      "osv",
      "vulnerable",
    );

    expect(packages).toEqual([
      { ecosystem: "npm", name: "lodash", version: "4.17.15" },
    ]);
  });
});
