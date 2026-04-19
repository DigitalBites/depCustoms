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
  },
}));

import { db } from "../../db/index.js";
import {
  listTenantVulnerablePackages,
  loadTenantOsvSummary,
} from "../../features/security/tenant-package-shared.js";
import { TEST_TENANT_ID, q } from "../helpers/fakes.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.execute).mockReset();
  vi.mocked(db.select).mockReset();
});

describe("tenant package shared helpers", () => {
  it("loads tenant OSV summary and computes fix-not-applied set", async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce([
        {
          total_packages: "4",
          critical_count: "1",
          high_count: "1",
          medium_count: "0",
          low_count: "1",
          clean_count: "1",
          unscanned_count: "1",
          fixable_count: "2",
          network_exploitable_count: "1",
          oldest_crit_high_advisory: "2026-04-01T00:00:00Z",
        },
      ] as any)
      .mockResolvedValueOnce([
        {
          ecosystem: "npm",
          name: "lodash",
          version: "4.17.15",
          fix_version: "4.17.21",
        },
      ] as any);
    vi.mocked(db.select)
      .mockReturnValueOnce(q([{ lastSyncedAt: "2026-04-18T00:00:00Z" }]) as any)
      .mockReturnValueOnce(
        q([{ ecosystem: "npm", name: "lodash", version: "4.17.15" }]) as any,
      );

    const result = await loadTenantOsvSummary(TEST_TENANT_ID, ["p-1"]);

    expect(result.summary).toEqual(
      expect.objectContaining({ total_packages: "4", high_count: "1" }),
    );
    expect(result.rawLastSynced).toBe("2026-04-18T00:00:00Z");
    expect(result.fixNotAppliedSet.has("npm|lodash|4.17.15")).toBe(true);
  });

  it("lists tenant vulnerable packages and computes total", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(
        q([
          {
            packageId: "pkg-1",
            cacheId: "cache-1",
            ecosystem: "npm",
            name: "lodash",
            version: "4.17.15",
            maxSeverity: "HIGH",
            total: "ignored",
          },
        ]) as any,
      )
      .mockReturnValueOnce(q([{ total: "1" }]) as any);

    const result = await listTenantVulnerablePackages(TEST_TENANT_ID, 0, 10);
    expect(result.total).toBe(1);
    expect(result.vulnPackages[0]).toEqual(
      expect.objectContaining({ name: "lodash", maxSeverity: "HIGH" }),
    );
  });
});
