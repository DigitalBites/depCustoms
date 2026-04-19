import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/index.js");
vi.mock("../../config.js", () => ({
  config: {
    databaseUrl: "postgres://test:test@localhost:5432/test",
    authUrl: "http://api.local",
    gotrueUrl: "http://gotrue.local",
    logLevel: "info",
    environment: "test",
  },
}));
vi.mock("../../features/mcp/services/project-access.js", () => ({
  requireMcpProjectAccess: vi.fn(),
}));
vi.mock("../../features/security/contributor-package-list-queries.js", () => ({
  loadProjectContributorSummary: vi.fn(),
  listProjectContributorPackages: vi.fn(),
}));
vi.mock("../../features/security/project-security-summary-query.js", () => ({
  loadProjectSecuritySummaryRow: vi.fn(),
}));
vi.mock("../../features/violations/finding-details.js", () => ({
  loadViolationFindings: vi.fn(),
}));
vi.mock("../../features/violations/enrichment.js", () => ({
  enrichViolations: vi.fn(),
}));
vi.mock("../../features/violations/project-shared.js", () => ({
  listProjectViolations: vi.fn(),
}));

import { db } from "../../db/index.js";
import type { McpRequestContext } from "../../features/mcp/context.js";
import { getProjectContributorSummaryForMcp } from "../../features/mcp/services/get-project-contributor-summary-service.js";
import { getProjectSecuritySummaryForMcp } from "../../features/mcp/services/get-project-security-summary-service.js";
import { listProjectContributorPackagesForMcp } from "../../features/mcp/services/list-project-contributor-packages-service.js";
import { listProjectFindingsForMcp } from "../../features/mcp/services/list-project-findings-service.js";
import { listProjectViolationsForMcp } from "../../features/mcp/services/list-project-violations-service.js";
import { requireMcpProjectAccess } from "../../features/mcp/services/project-access.js";
import {
  loadProjectContributorSummary,
  listProjectContributorPackages,
} from "../../features/security/contributor-package-list-queries.js";
import { loadProjectSecuritySummaryRow } from "../../features/security/project-security-summary-query.js";
import { loadViolationFindings } from "../../features/violations/finding-details.js";
import { enrichViolations } from "../../features/violations/enrichment.js";
import { listProjectViolations } from "../../features/violations/project-shared.js";
import {
  TEST_PROJECT_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  q,
} from "../helpers/fakes.js";

const ctx: McpRequestContext = {
  principal: {
    userId: TEST_USER_ID,
    tenantId: TEST_TENANT_ID,
    role: "owner",
    tenants: [
      {
        tenant_id: TEST_TENANT_ID,
        tenant_name: "Test Organisation",
        role: "owner",
      },
    ],
    audiences: ["authenticated", "mcp"],
    clientId: "codex",
    sessionId: "session-1",
  },
  requestId: "req-1",
  traceId: null,
  transportSessionId: "mcp-session-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMcpProjectAccess).mockResolvedValue(undefined);
  vi.mocked(db.select).mockReturnValue(q([]) as any);
});

describe("MCP contributor services", () => {
  it("returns project contributor summary", async () => {
    vi.mocked(loadProjectContributorSummary).mockResolvedValue({
      total_scanned: 5,
      not_scanned_count: 1,
      high_risk_count: 2,
      medium_risk_count: 1,
      low_risk_count: 1,
      clean_count: 1,
      new_maintainer_count: 2,
      first_time_publisher_count: 1,
      publisher_change_count: 1,
      install_scripts_count: 3,
      last_scored_at: new Date("2026-04-16T00:00:00Z"),
    } as any);

    const result = await getProjectContributorSummaryForMcp(
      ctx,
      TEST_PROJECT_ID,
    );

    expect(result.packages.by_risk.high).toBe(2);
    expect(result.signals.install_scripts_count).toBe(3);
  });

  it("adds contributor data to the project security summary", async () => {
    vi.mocked(loadProjectSecuritySummaryRow).mockResolvedValue({
      open_count: 4,
      suppressed_count: 1,
      critical_open_count: 1,
      high_open_count: 2,
      medium_open_count: 1,
      low_open_count: 0,
      oldest_open_at: new Date("2026-04-10T00:00:00Z"),
      blocks_30d: 6,
      blocks_7d: 2,
      blocks_prior_7d: 1,
      suppressions_count: 1,
      last_synced_at: new Date("2026-04-16T00:00:00Z"),
      new_findings: 2,
      synced_count: 5,
    } as any);
    vi.mocked(loadProjectContributorSummary).mockResolvedValue({
      total_scanned: 5,
      not_scanned_count: 1,
      high_risk_count: 2,
      medium_risk_count: 1,
      low_risk_count: 1,
      clean_count: 1,
      new_maintainer_count: 2,
      first_time_publisher_count: 1,
      publisher_change_count: 1,
      install_scripts_count: 3,
      last_scored_at: new Date("2026-04-16T00:00:00Z"),
    } as any);

    const result = await getProjectSecuritySummaryForMcp(ctx, TEST_PROJECT_ID);

    expect(result.connectors.contributor.packages.by_risk.high).toBe(2);
    expect(result.connectors.contributor.signals.install_scripts_count).toBe(3);
  });

  it("lists project contributor packages with contributor context", async () => {
    vi.mocked(listProjectContributorPackages).mockResolvedValue({
      total: 1,
      packages: [
        {
          ecosystem: "npm",
          name: "left-pad",
          version: "1.0.0",
          version_published_at: new Date("2026-01-01T00:00:00Z"),
          latest_version: "1.1.0",
          score: 82,
          score_tier: "HIGH",
          publisher: "bob",
          publisher_seen_before_package: false,
          publisher_seen_count_before: 0,
          publisher_matches_prior_version: false,
          maintainer_set_changed: true,
          new_maintainer_count: 2,
          removed_maintainer_count: 1,
          maintainer_count: 3,
          has_install_scripts: true,
          has_provenance: false,
          has_trusted_publisher: false,
          release_velocity_7d: 5,
          release_velocity_30d: 12,
          history_complete: true,
          raw_factors: { install_scripts: 25 },
          last_scored_at: new Date("2026-04-16T00:00:00Z"),
          last_pulled_at: new Date("2026-04-16T00:10:00Z"),
        },
      ],
    } as any);

    const result = await listProjectContributorPackagesForMcp(
      ctx,
      TEST_PROJECT_ID,
      {},
    );

    expect(result.packages[0]?.contributor_context.risk_score).toBe(82);
    expect(result.packages[0]?.contributor_context.publisher).toBe("bob");
  });

  it("enriches MCP findings with advisory details on demand", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(
        q([
          {
            id: "pf-1",
            project_id: TEST_PROJECT_ID,
            tenant_id: TEST_TENANT_ID,
            connector_key: "contributor",
            entity_id: "npm:left-pad:1.0.0",
            finding_id: "contributor_signals",
            severity: "HIGH",
            title: "Contributor risk score: 82",
            status: "open",
            last_seen_at: new Date("2026-04-16T00:00:00Z"),
          },
        ]) as any,
      )
      .mockReturnValueOnce(q([{ count: "1" }]) as any)
      .mockReturnValueOnce(
        q([{ entity_id: "npm:left-pad:1.0.0", count: "2" }]) as any,
      );

    vi.mocked(loadViolationFindings).mockResolvedValue({
      findings: [
        {
          connector_key: "contributor",
          finding_id: "contributor_signals",
          advisory: {
            published_at: "2026-04-15T00:00:00Z",
            attributes: { publisher: "bob", new_maintainer_count: 1 },
          },
        },
      ],
      findingSchemas: {
        contributor: [
          { key: "publisher", label: "Publisher", dataType: "string" },
        ],
      },
    } as any);

    const result = await listProjectFindingsForMcp(ctx, TEST_PROJECT_ID, {
      include_details: true,
    });

    expect(result.findings[0]?.advisory?.attributes).toEqual(
      expect.objectContaining({ publisher: "bob" }),
    );
    expect(result.findings[0]?.finding_schema).toEqual([
      expect.objectContaining({ key: "publisher" }),
    ]);
  });

  it("enriches MCP violations with finding details on demand", async () => {
    vi.mocked(listProjectViolations).mockResolvedValue([
      {
        id: "vio-1",
        project_id: TEST_PROJECT_ID,
        tenant_id: TEST_TENANT_ID,
        entity_id: "npm:left-pad:1.0.0",
      },
    ] as any);
    vi.mocked(enrichViolations).mockResolvedValue([
      {
        id: "vio-1",
        project_id: TEST_PROJECT_ID,
        tenant_id: TEST_TENANT_ID,
        entity_id: "npm:left-pad:1.0.0",
        finding_count: 1,
      },
    ] as any);
    vi.mocked(loadViolationFindings).mockResolvedValue({
      findings: [
        {
          connector_key: "contributor",
          finding_id: "contributor_signals",
          advisory: {
            published_at: "2026-04-15T00:00:00Z",
            attributes: { publisher: "bob" },
          },
        },
      ],
      findingSchemas: {
        contributor: [
          { key: "publisher", label: "Publisher", dataType: "string" },
        ],
      },
    } as any);

    const result = await listProjectViolationsForMcp(ctx, TEST_PROJECT_ID, {
      include_details: true,
    });

    expect(result.violations[0]?.findings).toHaveLength(1);
    expect(result.violations[0]?.finding_schemas?.contributor).toEqual([
      expect.objectContaining({ key: "publisher" }),
    ]);
  });
});
