import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    environment: "test",
    databaseUrl: "postgresql://localhost/customs-unit-fake",
  },
}));

vi.mock("../../db/index.js", () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from "../../db/index.js";
import { loadProjectOsvSummary } from "../../features/security/package-summary-queries.js";
import { TEST_PROJECT_ID, TEST_TENANT_ID } from "../helpers/fakes.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.execute).mockReset();
});

describe("package summary queries", () => {
  it("loads project OSV summary and computes unresolved fix candidates", async () => {
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
          last_synced_at: new Date("2026-04-18T00:00:00Z"),
          synced_count: 7,
          new_findings: 2,
        },
      ] as any)
      .mockResolvedValueOnce([
        { ecosystem: "npm", name: "lodash", versions: ["4.17.15"] },
        { ecosystem: "pypi", name: "requests", versions: ["2.32.0"] },
      ] as any)
      .mockResolvedValueOnce([
        {
          ecosystem: "npm",
          name: "lodash",
          version: "4.17.15",
          fix_version: "4.17.21",
        },
        {
          ecosystem: "pypi",
          name: "requests",
          version: "2.32.0",
          fix_version: "2.32.0",
        },
      ] as any);

    const result = await loadProjectOsvSummary(TEST_PROJECT_ID, TEST_TENANT_ID);

    expect(result.summary).toEqual(
      expect.objectContaining({
        total_packages: "4",
        last_synced_at: new Date("2026-04-18T00:00:00Z"),
      }),
    );
    expect(result.fixNotAppliedSet.has("npm|lodash|4.17.15")).toBe(true);
    expect(result.fixNotAppliedSet.has("pypi|requests|2.32.0")).toBe(false);
  });
});
