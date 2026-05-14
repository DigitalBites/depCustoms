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
import { q, TEST_PROJECT_ID, TEST_TENANT_ID } from "../helpers/fakes.js";
import { loadProjectPackageFindingContext } from "../../features/security/package-finding-context.js";
import { loadTenantPackageContext } from "../../features/security/tenant-package-shared.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.execute).mockReset();
  vi.mocked(db.select).mockReset();
});

describe("package context loaders", () => {
  it("loads project package finding context and expands cache findings", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        {
          id: "cache-1",
          data: {
            findings: [
              {
                id: "OSV-1",
                severity: "HIGH",
                title: "Prototype pollution",
                published_at: "2026-03-20T00:00:00Z",
                attributes: { attack_vector: "NETWORK" },
              },
            ],
          },
        },
      ]) as any,
    );
    vi.mocked(db.execute).mockResolvedValueOnce([
      {
        package_version_id: "pkgver-1",
        dispositions: [
          {
            id: "disp-1",
            findingId: "OSV-1",
            severity: "HIGH",
            status: "open",
            observationStatus: null,
          },
        ],
        open_violation_count: "2",
      },
    ] as any);

    const result = await loadProjectPackageFindingContext(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      ["cache-1"],
      ["pkgver-1"],
    );

    expect(result.cacheFindings).toEqual([
      expect.objectContaining({
        cacheId: "cache-1",
        findingId: "OSV-1",
        severity: "HIGH",
        title: "Prototype pollution",
      }),
    ]);
    expect(result.entityContextRows).toEqual([
      expect.objectContaining({
        package_version_id: "pkgver-1",
        open_violation_count: "2",
      }),
    ]);
  });

  it("handles empty cache ids when loading project finding context", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([] as any);

    const result = await loadProjectPackageFindingContext(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      [],
      ["pkgver-1"],
    );

    expect(result).toEqual({
      cacheFindings: [],
      entityContextRows: [],
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("loads tenant package context with cache findings, violations, and package projects", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(
        q([
          {
            id: "cache-1",
            data: {
              findings: [
                {
                  id: "OSV-2",
                  severity: "MEDIUM",
                  title: "Moderate issue",
                  published_at: "2026-03-21T00:00:00Z",
                  attributes: {},
                },
              ],
            },
          },
        ]) as any,
      )
      .mockReturnValueOnce(
        q([{ packageVersionId: "pkgver-2", count: "3" }]) as any,
      )
      .mockReturnValueOnce(
        q([
          { packageId: "pkg-2", projectId: "p-1", projectName: "Alpha" },
        ]) as any,
      );

    const result = await loadTenantPackageContext(
      TEST_TENANT_ID,
      ["cache-1"],
      ["pkg-2"],
      ["pkgver-2"],
    );

    expect(result.cacheFindings).toEqual([
      expect.objectContaining({
        cacheId: "cache-1",
        findingId: "OSV-2",
      }),
    ]);
    expect(result.violationCountRows).toEqual([
      { packageVersionId: "pkgver-2", count: "3" },
    ]);
    expect(result.packageProjects).toEqual([
      { packageId: "pkg-2", projectId: "p-1", projectName: "Alpha" },
    ]);
  });

  it("short-circuits empty cache and package inputs in tenant package context", async () => {
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any);

    const result = await loadTenantPackageContext(
      TEST_TENANT_ID,
      [],
      [],
      ["pkgver-2"],
    );

    expect(result.cacheFindings).toEqual([]);
    expect(result.packageProjects).toEqual([]);
    expect(result.violationCountRows).toEqual([]);
  });
});
