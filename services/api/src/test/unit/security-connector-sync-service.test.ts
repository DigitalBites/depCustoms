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
    select: vi.fn(),
    insert: vi.fn(),
    execute: vi.fn(),
  },
}));

vi.mock("../../connectors/cache.js", () => ({
  upsertCachedResultWithFindings: vi.fn(),
}));

vi.mock("../../features/security/project-findings.js", () => ({
  upsertProjectFindingsForEntity: vi.fn(async () => ({ newFindings: 1 })),
}));

import { db } from "../../db/index.js";
import { upsertCachedResultWithFindings } from "../../connectors/cache.js";
import { q, TEST_PROJECT_ID, TEST_TENANT_ID } from "../helpers/fakes.js";
import {
  loadConnectorSyncCooldown,
  runProjectConnectorSync,
} from "../../features/security/connector-sync-service.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.select).mockReset();
  vi.mocked(db.insert).mockReset();
  vi.mocked(db.execute).mockReset();
  vi.mocked(db.insert).mockReturnValue(q([]) as any);
  vi.mocked(db.execute).mockResolvedValue({ rowCount: 0 } as any);
});

describe("connector sync service", () => {
  it("returns null when no prior sync exists", async () => {
    vi.mocked(db.select).mockReturnValue(q([]) as any);

    const retryAfter = await loadConnectorSyncCooldown(TEST_PROJECT_ID, "osv");
    expect(retryAfter).toBeNull();
  });

  it("returns a retry delay when sync is still cooling down", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([{ last_synced_at: new Date(Date.now() - 5 * 60 * 1000) }]) as any,
    );

    const retryAfter = await loadConnectorSyncCooldown(TEST_PROJECT_ID, "osv");
    expect(retryAfter).toBeGreaterThan(0);
  });

  it("skips sync bookkeeping when there are no packages to sync", async () => {
    const result = await runProjectConnectorSync({
      tenantId: TEST_TENANT_ID,
      projectId: TEST_PROJECT_ID,
      connectorKey: "osv",
      connector: {} as any,
      packagesToSync: [],
    });

    expect(result).toEqual({
      synced: 0,
      newFindings: 0,
      reopened: 0,
      durationMs: 0,
    });
  });

  it("syncs findings, counts new findings, and records sync metrics", async () => {
    const connector = {
      id: "osv",
      supportedEcosystems: ["npm"],
      subscribedEvents: [
        { kind: "artifact_request", executionMode: "sync_required" },
      ],
      supportsEvent: vi.fn(() => true),
      handleEvent: vi.fn(async () => ({
        summary: {
          vulnerability: {
            maxSeverity: "HIGH",
            findingCount: 1,
            fixAvailable: true,
            bestFixVersion: "4.17.21",
          },
        },
        findings: [
          {
            findingId: "OSV-1",
            severity: "HIGH",
            title: "Prototype pollution",
          },
        ],
      })),
    };
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any);
    vi.mocked(db.insert)
      .mockReturnValueOnce(
        q([{ id: "pkg-1", ecosystem: "npm", package: "lodash" }]) as any,
      )
      .mockReturnValueOnce(
        q([{ id: "pkgver-1", package_id: "pkg-1", version: "4.17.15" }]) as any,
      )
      .mockReturnValue(q([]) as any);

    const result = await runProjectConnectorSync({
      tenantId: TEST_TENANT_ID,
      projectId: TEST_PROJECT_ID,
      connectorKey: "osv",
      connector: connector as any,
      packagesToSync: [
        {
          packageId: "pkg-1",
          packageVersionId: "pkgver-1",
          ecosystem: "npm",
          name: "lodash",
          version: "4.17.15",
        },
      ],
    });

    expect(connector.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "artifact_request",
        ecosystem: "npm",
        packageName: "lodash",
        version: "4.17.15",
        packageId: "pkg-1",
        packageVersionId: "pkgver-1",
        context: {
          projectId: TEST_PROJECT_ID,
          tenantId: TEST_TENANT_ID,
        },
      }),
    );
    expect(upsertCachedResultWithFindings).toHaveBeenCalledOnce();
    expect(result.synced).toBe(1);
    expect(result.newFindings).toBe(1);
  });

  it("continues when a package sync throws", async () => {
    const connector = {
      id: "osv",
      supportedEcosystems: ["npm"],
      subscribedEvents: [
        { kind: "artifact_request", executionMode: "sync_required" },
      ],
      supportsEvent: vi.fn(() => true),
      handleEvent: vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({
          summary: {
            vulnerability: {
              maxSeverity: "NONE",
              findingCount: 0,
              fixAvailable: false,
              bestFixVersion: null,
            },
          },
          findings: [],
        }),
    };

    const result = await runProjectConnectorSync({
      tenantId: TEST_TENANT_ID,
      projectId: TEST_PROJECT_ID,
      connectorKey: "osv",
      connector: connector as any,
      packagesToSync: [
        {
          packageId: "pkg-1",
          packageVersionId: "pkgver-1",
          ecosystem: "npm",
          name: "broken",
          version: "1.0.0",
        },
        {
          packageId: "pkg-2",
          packageVersionId: "pkgver-2",
          ecosystem: "npm",
          name: "ok",
          version: "1.0.1",
        },
      ],
    });

    expect(result.synced).toBe(2);
    expect(connector.handleEvent).toHaveBeenCalledTimes(2);
  });
});
