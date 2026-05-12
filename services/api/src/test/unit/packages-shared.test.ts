import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/index.js");

import { db } from "../../db/index.js";
import {
  listProjectPackages,
  listTenantPackages,
  rebuildProjectPackages,
} from "../../features/packages/shared.js";
import { q, TEST_PROJECT_ID, TEST_TENANT_ID } from "../helpers/fakes.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.select).mockReturnValue(q([]) as any);
});

describe("package listing queries", () => {
  it("includes used and latest version fields for project package listings", async () => {
    await listProjectPackages(TEST_PROJECT_ID, TEST_TENANT_ID);

    expect(vi.mocked(db.select)).toHaveBeenCalledWith(
      expect.objectContaining({
        version: expect.anything(),
        name: expect.anything(),
        package: expect.anything(),
        used_version: expect.anything(),
        used_version_published_at: expect.anything(),
        latest_version: expect.anything(),
        latest_version_published_at: expect.anything(),
        is_latest: expect.anything(),
        latest_package_version_id: expect.anything(),
      }),
    );

    const builder = vi.mocked(db.select).mock.results[0]?.value;
    expect(builder.leftJoin).toHaveBeenCalledTimes(1);
  });

  it("includes used and latest version fields for tenant package listings", async () => {
    await listTenantPackages(TEST_TENANT_ID);

    expect(vi.mocked(db.select)).toHaveBeenCalledWith(
      expect.objectContaining({
        version: expect.anything(),
        name: expect.anything(),
        package: expect.anything(),
        used_version: expect.anything(),
        used_version_published_at: expect.anything(),
        latest_version: expect.anything(),
        latest_version_published_at: expect.anything(),
        is_latest: expect.anything(),
        latest_package_version_id: expect.anything(),
      }),
    );

    const builder = vi.mocked(db.select).mock.results[0]?.value;
    expect(builder.leftJoin).toHaveBeenCalledTimes(1);
  });

  it("returns zero when rebuild finds no proxy package events", async () => {
    vi.mocked(db.transaction).mockImplementationOnce(async (fn: any) => {
      const tx = {
        select: vi.fn().mockReturnValue(q([])),
        delete: vi.fn().mockReturnValue(q([])),
      };
      return fn(tx);
    });

    await expect(
      rebuildProjectPackages(TEST_PROJECT_ID, TEST_TENANT_ID),
    ).resolves.toBe(0);
  });

  it("rebuilds package usage rows from aggregated proxy events", async () => {
    const tx = {
      select: vi.fn().mockReturnValue(
        q([
          {
            package_version_id: "pv-1",
            request_count: 5,
            allow_count: 4,
            block_count: 1,
            first_seen_at: new Date("2026-04-01T00:00:00Z"),
            last_seen_at: new Date("2026-04-03T00:00:00Z"),
          },
        ]),
      ),
      delete: vi.fn().mockReturnValue(q([])),
      insert: vi.fn().mockReturnValueOnce(q([])),
    };
    vi.mocked(db.transaction).mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      rebuildProjectPackages(TEST_PROJECT_ID, TEST_TENANT_ID),
    ).resolves.toBe(1);

    expect(tx.delete).toHaveBeenCalledOnce();
    expect(tx.insert).toHaveBeenCalledOnce();
  });

  it("rebuilds package usage directly from event catalog references", async () => {
    const tx = {
      select: vi.fn().mockReturnValue(
        q([
          {
            package_version_id: "pv-1",
            request_count: 2,
            allow_count: 2,
            block_count: 0,
            first_seen_at: new Date("2026-04-02T00:00:00Z"),
            last_seen_at: new Date("2026-04-02T00:00:00Z"),
          },
          {
            package_version_id: "pv-2",
            request_count: 3,
            allow_count: 2,
            block_count: 1,
            first_seen_at: new Date("2026-04-01T00:00:00Z"),
            last_seen_at: new Date("2026-04-04T00:00:00Z"),
          },
        ]),
      ),
      delete: vi.fn().mockReturnValue(q([])),
      insert: vi.fn().mockReturnValueOnce(q([])),
    };
    vi.mocked(db.transaction).mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      rebuildProjectPackages(TEST_PROJECT_ID, TEST_TENANT_ID),
    ).resolves.toBe(2);

    const usageInsertBuilder = tx.insert.mock.results[0]?.value;
    expect(usageInsertBuilder.values).toHaveBeenCalledWith([
      expect.objectContaining({
        package_version_id: "pv-1",
        request_count: 2,
        allow_count: 2,
        block_count: 0,
        created_at: new Date("2026-04-02T00:00:00Z"),
        updated_at: new Date("2026-04-02T00:00:00Z"),
      }),
      expect.objectContaining({
        package_version_id: "pv-2",
        request_count: 3,
        allow_count: 2,
        block_count: 1,
        created_at: new Date("2026-04-01T00:00:00Z"),
        updated_at: new Date("2026-04-04T00:00:00Z"),
      }),
    ]);
  });
});
