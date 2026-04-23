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
vi.mock("../../features/mcp/services/package-guidance-service.js", () => ({
  loadPackageVersionContext: vi.fn(),
  previewPackageDecision: vi.fn(),
  listObservedProjectPackageVersions: vi.fn(),
  loadLatestKnownPackageVersion: vi.fn(),
  toIsoString: vi.fn((value: Date | string | null | undefined) => {
    if (!value) return null;
    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }),
  severityRank: vi.fn((severity: string | null) => {
    switch (severity) {
      case "CRITICAL":
        return 4;
      case "HIGH":
        return 3;
      case "MEDIUM":
        return 2;
      case "LOW":
        return 1;
      default:
        return 0;
    }
  }),
}));
vi.mock("../../features/security/package-list-queries.js", () => ({
  listProjectVulnerablePackages: vi.fn(),
}));

import { db } from "../../db/index.js";
import {
  q,
  TEST_PROJECT_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
} from "../helpers/fakes.js";
import type { McpRequestContext } from "../../features/mcp/context.js";
import { explainPackageDecisionForMcp } from "../../features/mcp/services/explain-package-decision-service.js";
import { suggestAllowedVersionsForMcp } from "../../features/mcp/services/suggest-allowed-versions-service.js";
import { previewDependencyChangeForMcp } from "../../features/mcp/services/preview-dependency-change-service.js";
import { getProjectDependencyContextForMcp } from "../../features/mcp/services/get-project-dependency-context-service.js";
import { listVulnerablePackagesForMcp } from "../../features/mcp/services/list-vulnerable-packages-service.js";
import { findProjectsUsingPackageForMcp } from "../../features/mcp/services/find-projects-using-package-service.js";
import { requireMcpProjectAccess } from "../../features/mcp/services/project-access.js";
import {
  listObservedProjectPackageVersions,
  loadLatestKnownPackageVersion,
  loadPackageVersionContext,
  previewPackageDecision,
} from "../../features/mcp/services/package-guidance-service.js";
import { listProjectVulnerablePackages } from "../../features/security/package-list-queries.js";

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

describe("MCP guidance services", () => {
  it("explainPackageDecisionForMcp merges preview and package context", async () => {
    vi.mocked(loadPackageVersionContext).mockResolvedValue({
      ecosystem: "npm",
      package: "left-pad",
      version: "1.0.0",
      package_id: "pkg-1",
      used_version_published_at: "2026-01-01T00:00:00.000Z",
      latest_version: "1.1.0",
      latest_version_published_at: "2026-02-01T00:00:00.000Z",
      is_latest: false,
      latest_package_version_id: "pkgv-2",
      fix_available: true,
      fix_version: "1.1.0",
      vuln_count: 2,
      max_severity: "HIGH",
      recently_observed: true,
      request_count: 4,
      allow_count: 2,
      block_count: 2,
      first_seen_at: "2026-01-03T00:00:00.000Z",
      last_seen_at: "2026-01-04T00:00:00.000Z",
      open_findings_count: 1,
      finding_summary: "Known vuln",
      historical_blocks_count: 2,
      last_blocked_at: "2026-01-04T00:00:00.000Z",
      last_block_reason_code: "POLICY_BLOCKED",
      last_block_reason_summary: "Blocked by policy",
      last_block_matched_rule: "Block risky packages",
      last_block_enforcement_mode: "enforcing",
    });
    vi.mocked(previewPackageDecision).mockResolvedValue({
      decision: "block",
      reason_code: "POLICY_BLOCKED",
      reason_summary: "Blocked by policy",
      matched_rule: "Block risky packages",
      enforcement_mode: "enforcing",
      blocked_by_rule_id: "rule-1",
      policies_evaluated: 1,
      rules_evaluated: 2,
      rules_matched: 1,
      snapshot_statuses: { osv: "ok" },
      used_snapshot_count: 1,
    });

    const result = await explainPackageDecisionForMcp(ctx, {
      projectId: TEST_PROJECT_ID,
      ecosystem: "npm",
      packageName: "left-pad",
      version: "1.0.0",
    });

    expect(result.fix_version).toBe("1.1.0");
    expect(result.latest_version).toBe("1.1.0");
    expect(result.snapshot_statuses).toEqual({ osv: "ok" });
  });

  it("suggestAllowedVersionsForMcp includes a global latest fallback candidate", async () => {
    vi.mocked(listObservedProjectPackageVersions).mockResolvedValue([
      {
        version: "1.0.0",
        used_version_published_at: new Date("2026-01-01T00:00:00Z"),
        is_latest: false,
        latest_package_version_id: null,
        latest_version: null,
        latest_version_published_at: null,
        fix_version: null,
        fix_available: false,
        max_severity: "HIGH",
        vuln_count: 1,
        request_count: 3,
        allow_count: 1,
        block_count: 2,
        first_seen_at: new Date("2026-01-03T00:00:00Z"),
        last_seen_at: new Date("2026-01-04T00:00:00Z"),
      },
    ] as any);
    vi.mocked(loadLatestKnownPackageVersion).mockResolvedValue({
      version: "1.1.0",
      published_at: new Date("2026-02-01T00:00:00Z"),
    } as any);
    vi.mocked(loadPackageVersionContext)
      .mockResolvedValueOnce({
        used_version_published_at: "2026-01-01T00:00:00.000Z",
        latest_version: null,
        latest_version_published_at: null,
        is_latest: false,
        fix_available: false,
        fix_version: null,
        open_findings_count: 1,
        max_severity: "HIGH",
        recently_observed: true,
        request_count: 3,
      } as any)
      .mockResolvedValueOnce({
        used_version_published_at: null,
        latest_version: "1.1.0",
        latest_version_published_at: "2026-02-01T00:00:00.000Z",
        is_latest: true,
        fix_available: false,
        fix_version: null,
        open_findings_count: 0,
        max_severity: "NONE",
        recently_observed: false,
        request_count: 0,
      } as any);
    vi.mocked(previewPackageDecision)
      .mockResolvedValueOnce({
        decision: "block",
        reason_code: "POLICY_BLOCKED",
        reason_summary: "Blocked by policy",
        matched_rule: "Block risky packages",
        enforcement_mode: "enforcing",
      } as any)
      .mockResolvedValueOnce({
        decision: "allow",
        reason_code: "allowed",
        reason_summary: "No policy rules matched",
        matched_rule: null,
        enforcement_mode: null,
      } as any);

    const result = await suggestAllowedVersionsForMcp(ctx, {
      projectId: TEST_PROJECT_ID,
      ecosystem: "npm",
      packageName: "left-pad",
      currentVersion: "1.0.0",
    });

    expect(result.suggested_version).toBe("1.1.0");
    expect(result.candidates.map((candidate) => candidate.version)).toContain(
      "1.1.0",
    );
  });

  it("previewDependencyChangeForMcp compares from/to versions", async () => {
    vi.mocked(loadPackageVersionContext)
      .mockResolvedValueOnce({
        open_findings_count: 2,
        max_severity: "HIGH",
        fix_version: "1.1.0",
        latest_version: "1.1.0",
        is_latest: false,
        recently_observed: true,
      } as any)
      .mockResolvedValueOnce({
        open_findings_count: 0,
        max_severity: "NONE",
        fix_version: null,
        latest_version: "1.1.0",
        is_latest: true,
        recently_observed: false,
      } as any);
    vi.mocked(previewPackageDecision)
      .mockResolvedValueOnce({
        decision: "block",
        reason_code: "POLICY_BLOCKED",
        reason_summary: "Blocked by policy",
        matched_rule: "Block risky packages",
        enforcement_mode: "enforcing",
      } as any)
      .mockResolvedValueOnce({
        decision: "allow",
        reason_code: "allowed",
        reason_summary: "No policy rules matched",
        matched_rule: null,
        enforcement_mode: null,
      } as any);

    const result = await previewDependencyChangeForMcp(ctx, {
      projectId: TEST_PROJECT_ID,
      ecosystem: "npm",
      packageName: "left-pad",
      fromVersion: "1.0.0",
      toVersion: "1.1.0",
    });

    expect(result.comparison.outcome).toBe("improves");
    expect(result.comparison.moves_to_latest).toBe(true);
  });

  it("getProjectDependencyContextForMcp reuses suggestion results", async () => {
    vi.mocked(listObservedProjectPackageVersions).mockResolvedValue([
      {
        version: "1.0.0",
        used_version_published_at: new Date("2026-01-01T00:00:00Z"),
        latest_version: "1.1.0",
        latest_version_published_at: new Date("2026-02-01T00:00:00Z"),
        is_latest: false,
        fix_available: true,
        fix_version: "1.1.0",
        max_severity: "HIGH",
        vuln_count: 1,
        request_count: 3,
        allow_count: 1,
        block_count: 2,
        first_seen_at: new Date("2026-01-03T00:00:00Z"),
        last_seen_at: new Date("2026-01-04T00:00:00Z"),
      },
      {
        version: "1.1.0",
        used_version_published_at: new Date("2026-02-01T00:00:00Z"),
        latest_version: "1.1.0",
        latest_version_published_at: new Date("2026-02-01T00:00:00Z"),
        is_latest: true,
        fix_available: false,
        fix_version: null,
        max_severity: "NONE",
        vuln_count: 0,
        request_count: 1,
        allow_count: 1,
        block_count: 0,
        first_seen_at: new Date("2026-02-02T00:00:00Z"),
        last_seen_at: new Date("2026-02-03T00:00:00Z"),
      },
    ] as any);
    vi.mocked(loadLatestKnownPackageVersion).mockResolvedValue(null as any);
    vi.mocked(loadPackageVersionContext)
      .mockResolvedValueOnce({
        used_version_published_at: "2026-01-01T00:00:00.000Z",
        latest_version: "1.1.0",
        latest_version_published_at: "2026-02-01T00:00:00.000Z",
        is_latest: false,
        fix_available: true,
        fix_version: "1.1.0",
        open_findings_count: 1,
        max_severity: "HIGH",
        recently_observed: true,
        request_count: 3,
      } as any)
      .mockResolvedValueOnce({
        used_version_published_at: "2026-02-01T00:00:00.000Z",
        latest_version: "1.1.0",
        latest_version_published_at: "2026-02-01T00:00:00.000Z",
        is_latest: true,
        fix_available: false,
        fix_version: null,
        open_findings_count: 0,
        max_severity: "NONE",
        recently_observed: false,
        request_count: 0,
      } as any);
    vi.mocked(previewPackageDecision)
      .mockResolvedValueOnce({
        decision: "block",
        reason_code: "POLICY_BLOCKED",
        reason_summary: "Blocked by policy",
        matched_rule: "Block risky packages",
        enforcement_mode: "enforcing",
      } as any)
      .mockResolvedValueOnce({
        decision: "allow",
        reason_code: "allowed",
        reason_summary: "No policy rules matched",
        matched_rule: null,
        enforcement_mode: null,
      } as any);

    const result = await getProjectDependencyContextForMcp(ctx, {
      projectId: TEST_PROJECT_ID,
      ecosystem: "npm",
      packageName: "left-pad",
    });

    expect(result.recommended_version).toBe("1.1.0");
    expect(result.versions).toHaveLength(2);
    expect(result.suggestions).toHaveLength(2);
  });

  it("listVulnerablePackagesForMcp returns simplified triage data", async () => {
    vi.mocked(listProjectVulnerablePackages).mockResolvedValue({
      vulnPackages: [
        {
          ecosystem: "npm",
          name: "left-pad",
          version: "1.0.0",
          versionPublishedAt: new Date("2026-01-01T00:00:00Z"),
          osvMaxSeverity: "HIGH",
          osvFindingCount: 2,
          osvFixAvailable: true,
          osvBestFixVersion: "1.1.0",
          latestVersion: "1.1.0",
          latestVersionPublishedAt: new Date("2026-02-01T00:00:00Z"),
          lastPulledAt: new Date("2026-03-01T00:00:00Z"),
        },
      ],
      total: 1,
    } as any);

    const result = await listVulnerablePackagesForMcp(ctx, TEST_PROJECT_ID, {});

    expect(result.packages[0].best_fix_version).toBe("1.1.0");
    expect(result.pagination.total).toBe(1);
  });

  it("findProjectsUsingPackageForMcp enforces owner/admin and paginates", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(
        q([
          {
            project_id: TEST_PROJECT_ID,
            project_name: "Dev Project",
            ecosystem: "npm",
            package: "left-pad",
            version: "1.0.0",
            used_version_published_at: new Date("2026-01-01T00:00:00Z"),
            is_latest: false,
            latest_version: "1.1.0",
            latest_version_published_at: new Date("2026-02-01T00:00:00Z"),
            request_count: 3,
            allow_count: 1,
            block_count: 2,
            first_seen_at: new Date("2026-01-03T00:00:00Z"),
            last_seen_at: new Date("2026-01-04T00:00:00Z"),
          },
        ]) as any,
      )
      .mockReturnValueOnce(q([{ count: "1" }]) as any);

    const result = await findProjectsUsingPackageForMcp(ctx, {
      ecosystem: "npm",
      packageName: "left-pad",
      limit: 25,
      offset: 0,
    });

    expect(result.project_count).toBe(1);
    expect(result.pagination.total).toBe(1);
  });

  it("findProjectsUsingPackageForMcp rejects roles without tenant-wide MCP package usage access", async () => {
    await expect(
      findProjectsUsingPackageForMcp(
        {
          ...ctx,
          principal: { ...ctx.principal, role: "member" },
        },
        {
          ecosystem: "npm",
          packageName: "left-pad",
        },
      ),
    ).rejects.toThrow("Tenant-wide MCP package usage access is required");
  });
});
