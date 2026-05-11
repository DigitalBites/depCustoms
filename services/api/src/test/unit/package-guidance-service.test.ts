import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/index.js");

import { db } from "../../db/index.js";
import { q, TEST_PROJECT_ID, TEST_TENANT_ID } from "../helpers/fakes.js";
import { loadPackageVersionContext } from "../../features/mcp/services/package-guidance-service.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("package-guidance-service", () => {
  it("normalizes string-backed timestamps from the database", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(
        q([
          {
            package_id: "pkg-1",
            used_version_published_at: "2026-01-01T00:00:00.000Z",
            is_latest: false,
            latest_package_version_id: "pkgv-2",
            latest_version: "4.17.21",
            latest_version_published_at: "2026-02-01T00:00:00.000Z",
            remediation_available: true,
            fix_version: "4.17.21",
            finding_count: 3,
            risk_tier: "HIGH",
          },
        ]) as any,
      )
      .mockReturnValueOnce(
        q([
          {
            latest_version: "4.17.21",
            latest_version_published_at: "2026-02-01T00:00:00.000Z",
          },
        ]) as any,
      )
      .mockReturnValueOnce(
        q([
          {
            severity: "HIGH",
            status: "open",
            title: "Prototype pollution",
          },
        ]) as any,
      )
      .mockReturnValueOnce(
        q([
          {
            first_seen_at: "2026-01-03T00:00:00.000Z",
            last_seen_at: "2026-01-04T00:00:00.000Z",
            request_count: 5,
            allow_count: 2,
            block_count: 3,
          },
        ]) as any,
      )
      .mockReturnValueOnce(
        q([
          {
            blocked_at: "2026-01-05T00:00:00.000Z",
            reason_code: "POLICY_BLOCKED",
            reason_summary: "Blocked by policy",
            matched_rule: "Block High CVEs",
            enforcement_mode: "enforcing",
          },
        ]) as any,
      )
      .mockReturnValueOnce(q([{ count: "2" }]) as any);

    const result = await loadPackageVersionContext(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      "npm",
      "lodash",
      "4.17.15",
    );

    expect(result.used_version_published_at).toBe("2026-01-01T00:00:00.000Z");
    expect(result.latest_version_published_at).toBe("2026-02-01T00:00:00.000Z");
    expect(result.first_seen_at).toBe("2026-01-03T00:00:00.000Z");
    expect(result.last_seen_at).toBe("2026-01-04T00:00:00.000Z");
    expect(result.last_blocked_at).toBe("2026-01-05T00:00:00.000Z");
  });
});
