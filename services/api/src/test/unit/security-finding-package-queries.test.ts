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
import { TEST_PROJECT_ID, TEST_TENANT_ID } from "../helpers/fakes.js";
import {
  listProjectFindingPackages,
  listTenantFindingPackages,
  listTenantFindingPackageProjects,
  loadProjectPackageEvidence,
  loadTenantPackageEvidence,
} from "../../features/security/finding-package-queries.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.execute).mockReset();
});

describe("finding-package-queries", () => {
  it("lists project finding packages and derives total from the first row", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([
      {
        entity_id: "npm:lodash:4.17.15",
        package_id: "pkg-1",
        package_version_id: "pv-1",
        osv_cache_id: "cache-1",
        ecosystem: "npm",
        name: "lodash",
        version: "4.17.15",
        total_count: "3",
      },
    ] as any);

    const result = await listProjectFindingPackages(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      {
        offset: 0,
        limit: 10,
        includeContributor: true,
      },
    );

    expect(result.total).toBe(3);
    expect(result.packages[0]).toEqual(
      expect.objectContaining({
        entity_id: "npm:lodash:4.17.15",
        name: "lodash",
      }),
    );
  });

  it("returns zero total when no project finding packages are found", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([] as any);

    const result = await listProjectFindingPackages(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      {
        offset: 0,
        limit: 10,
        includeContributor: false,
      },
    );

    expect(result).toEqual({ packages: [], total: 0 });
  });

  it("lists tenant finding packages and derives total from grouped rows", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([
      {
        entity_id: "npm:react:18.3.0",
        package_id: "pkg-2",
        package_version_id: "pv-2",
        osv_cache_id: "cache-2",
        ecosystem: "npm",
        name: "react",
        version: "18.3.0",
        total_count: "2",
      },
    ] as any);

    const result = await listTenantFindingPackages(TEST_TENANT_ID, {
      offset: 5,
      limit: 10,
      includeContributor: true,
    });

    expect(result.total).toBe(2);
    expect(result.packages[0]).toEqual(
      expect.objectContaining({
        entity_id: "npm:react:18.3.0",
        name: "react",
      }),
    );
  });

  it("returns package-project associations for tenant finding packages", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([
      {
        package_version_id: "pv-1",
        project_id: "p-1",
        project_name: "Alpha",
      },
      {
        package_version_id: "pv-1",
        project_id: "p-2",
        project_name: "Beta",
      },
    ] as any);

    const rows = await listTenantFindingPackageProjects(TEST_TENANT_ID, [
      "pv-1",
    ]);
    expect(rows).toEqual([
      {
        package_version_id: "pv-1",
        project_id: "p-1",
        project_name: "Alpha",
      },
      {
        package_version_id: "pv-1",
        project_id: "p-2",
        project_name: "Beta",
      },
    ]);
  });

  it("short-circuits tenant finding package projects when no ids are provided", async () => {
    const rows = await listTenantFindingPackageProjects(TEST_TENANT_ID, []);
    expect(rows).toEqual([]);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("loads project package evidence for specific entities", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([
      {
        entity_id: "npm:lodash:4.17.15",
        package_id: "pkg-1",
        package_version_id: "pv-1",
        osv_cache_id: "cache-1",
        ecosystem: "npm",
        name: "lodash",
        version: "4.17.15",
        total_count: "1",
      },
    ] as any);

    const rows = await loadProjectPackageEvidence(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      ["npm:lodash:4.17.15"],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        entity_id: "npm:lodash:4.17.15",
        package_id: "pkg-1",
      }),
    );
  });

  it("short-circuits project evidence lookup when entity ids are empty", async () => {
    const rows = await loadProjectPackageEvidence(
      TEST_PROJECT_ID,
      TEST_TENANT_ID,
      [],
    );
    expect(rows).toEqual([]);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("loads tenant package evidence for specific entities", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([
      {
        entity_id: "npm:react:18.3.0",
        package_id: "pkg-2",
        package_version_id: "pv-2",
        osv_cache_id: "cache-2",
        ecosystem: "npm",
        name: "react",
        version: "18.3.0",
        total_count: "1",
      },
    ] as any);

    const rows = await loadTenantPackageEvidence(TEST_TENANT_ID, [
      "npm:react:18.3.0",
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        entity_id: "npm:react:18.3.0",
        package_id: "pkg-2",
      }),
    );
  });

  it("short-circuits tenant evidence lookup when entity ids are empty", async () => {
    const rows = await loadTenantPackageEvidence(TEST_TENANT_ID, []);
    expect(rows).toEqual([]);
    expect(db.execute).not.toHaveBeenCalled();
  });
});
