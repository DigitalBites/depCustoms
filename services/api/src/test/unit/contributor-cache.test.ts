import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/index.js");

import { db } from "../../db/index.js";
import { buildCachedSnapshot } from "../../connectors/cache.js";
import type { PackageIntelligenceConnector } from "../../connectors/types.js";
import { q } from "../helpers/fakes.js";

const contributorConnector: PackageIntelligenceConnector = {
  id: "contributor",
  config: {
    cacheTtlSeconds: 3600,
    responseTimeoutMs: 1000,
    backgroundTimeoutMs: 1000,
    baseUrl: "",
  },
  supportedEcosystems: ["npm"],
  subscribedEvents: [{ kind: "artifact_request", executionMode: "async_preferred" }],
  supportsEvent() {
    return true;
  },
  async handleEvent() {
    return { action: "none" };
  },
  async initialize() {},
  async shutdown() {},
  getFieldCatalog() {
    return [];
  },
  normalizeToSnapshot() {
    throw new Error("not used");
  },
  getFindingSchema() {
    return [];
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildCachedSnapshot", () => {
  it("treats legacy contributor rows with empty findings as cache misses", async () => {
    vi.mocked(db.select).mockReturnValue(
      q([
        {
          connector_id: "contributor",
          ecosystem: "npm",
          package: "lodash",
          version: "4.17.15",
          max_severity: "NONE",
          vuln_count: 0,
          fix_available: false,
          best_fix_version: null,
          queried_at: new Date(),
          ttl_seconds: 3600,
          data: { score_model_version: "1.0", findings: [] },
        },
      ]) as never,
    );

    await expect(
      buildCachedSnapshot(
        db,
        contributorConnector,
        {
          id: "event-1",
          kind: "artifact_request",
          packageId: "pkg-1",
          packageVersionId: "pkgver-1",
          ecosystem: "npm",
          packageName: "lodash",
          version: "4.17.15",
          source: "proxy",
          observedAt: "2026-05-01T00:00:00.000Z",
        },
        "npm:lodash@4.17.15",
      ),
    ).resolves.toBeNull();
  });
});
