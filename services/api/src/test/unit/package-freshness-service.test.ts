import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/index.js");

import { db } from "../../db/index.js";
import {
  persistPackageLatestMetadata,
  persistPackageUsedVersionMetadata,
} from "../../features/package-freshness/service.js";
import { q } from "../helpers/fakes.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.transaction).mockImplementation(async (callback: any) =>
    callback(db),
  );
});

describe("persistPackageLatestMetadata", () => {
  it("upserts the latest package row and marks prior latest rows stale", async () => {
    vi.mocked(db.insert)
      .mockReturnValueOnce(q([{ id: "pkg-1" }]) as any)
      .mockReturnValueOnce(q([{ id: "latest-1" }]) as any);
    vi.mocked(db.update).mockReturnValueOnce(q(undefined) as any);

    await persistPackageLatestMetadata({
      ecosystem: "npm",
      package: "rolldown",
      latest_version: "1.0.0-rc.13",
      latest_published_at: "2026-04-08T00:00:00Z",
      observed_at: "2026-04-08T01:00:00Z",
    });

    expect(vi.mocked(db.update)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.insert)).toHaveBeenCalledTimes(2);

    const packageBuilder = vi.mocked(db.insert).mock.results[0]?.value;
    expect(packageBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        ecosystem: "npm",
        package: "rolldown",
      }),
    );

    const latestBuilder = vi.mocked(db.insert).mock.results[1]?.value;
    expect(latestBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        package_id: "pkg-1",
        version: "1.0.0-rc.13",
        published_at: new Date("2026-04-08T00:00:00Z"),
        last_metadata_seen_at: new Date("2026-04-08T01:00:00Z"),
      }),
    );
  });

  it("canonicalizes package identity before upserting latest metadata", async () => {
    vi.mocked(db.insert)
      .mockReturnValueOnce(q([{ id: "pkg-1" }]) as any)
      .mockReturnValueOnce(q([{ id: "latest-1" }]) as any);
    vi.mocked(db.update).mockReturnValueOnce(q(undefined) as any);

    await persistPackageLatestMetadata({
      ecosystem: " PyPI ",
      package: " My_Pkg.Name ",
      latest_version: " 1.0.0 ",
      latest_published_at: null,
      observed_at: "2026-04-08T01:00:00Z",
    });

    const packageBuilder = vi.mocked(db.insert).mock.results[0]?.value;
    expect(packageBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        ecosystem: "pypi",
        package: "my-pkg-name",
      }),
    );

    const latestBuilder = vi.mocked(db.insert).mock.results[1]?.value;
    expect(latestBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        version: "1.0.0",
      }),
    );
  });

  it("ignores latest metadata when identity or observed timestamp is invalid", async () => {
    await persistPackageLatestMetadata({
      ecosystem: "npm",
      package: "   ",
      latest_version: "1.0.0",
      latest_published_at: null,
      observed_at: "2026-04-08T01:00:00Z",
    });
    await persistPackageLatestMetadata({
      ecosystem: "npm",
      package: "pkg",
      latest_version: "1.0.0",
      latest_published_at: null,
      observed_at: "not-a-date",
    });

    expect(vi.mocked(db.transaction)).not.toHaveBeenCalled();
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it("guards latest pointer updates against older metadata observations", async () => {
    vi.mocked(db.insert)
      .mockReturnValueOnce(q([{ id: "pkg-1" }]) as any)
      .mockReturnValueOnce(q([{ id: "latest-1" }]) as any);
    vi.mocked(db.update).mockReturnValueOnce(q(undefined) as any);

    await persistPackageLatestMetadata({
      ecosystem: "npm",
      package: "pkg",
      latest_version: "1.0.0",
      latest_published_at: null,
      observed_at: "2026-04-08T01:00:00Z",
    });

    const updateBuilder = vi.mocked(db.update).mock.results[0]?.value;
    expect(updateBuilder.where).toHaveBeenCalledWith(expect.anything());
  });
});

describe("persistPackageUsedVersionMetadata", () => {
  it("upserts the used-version row without forcing latest linkage when latest data is absent", async () => {
    vi.mocked(db.insert)
      .mockReturnValueOnce(q([{ id: "pkg-1" }]) as any)
      .mockReturnValueOnce(q([{ id: "used-1" }]) as any);

    await persistPackageUsedVersionMetadata({
      ecosystem: "npm",
      package: "rolldown",
      used_version: "1.0.0-rc.13",
      used_version_published_at: "2026-04-08T00:00:00Z",
      observed_at: "2026-04-08T02:00:00Z",
      latest_version: null,
      latest_published_at: null,
    });

    const packageBuilder = vi.mocked(db.insert).mock.results[0]?.value;
    expect(packageBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        ecosystem: "npm",
        package: "rolldown",
      }),
    );

    const versionBuilder = vi.mocked(db.insert).mock.results[1]?.value;
    expect(versionBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        package_id: "pkg-1",
        version: "1.0.0-rc.13",
        published_at: new Date("2026-04-08T00:00:00Z"),
        last_used_at: new Date("2026-04-08T02:00:00Z"),
      }),
    );
  });

  it("links a used version back to the latest package row when latest metadata is present", async () => {
    vi.mocked(db.insert)
      .mockReturnValueOnce(q([{ id: "pkg-2" }]) as any)
      .mockReturnValueOnce(q([{ id: "latest-2" }]) as any)
      .mockReturnValueOnce(q([{ id: "used-2" }]) as any);
    vi.mocked(db.update).mockReturnValueOnce(q(undefined) as any);

    await persistPackageUsedVersionMetadata({
      ecosystem: "npm",
      package: "vite",
      used_version: "7.0.0",
      used_version_published_at: null,
      observed_at: "2026-04-08T03:00:00Z",
      latest_version: "7.1.0",
      latest_published_at: "2026-04-07T12:00:00Z",
    });

    const latestBuilder = vi.mocked(db.insert).mock.results[1]?.value;
    const latestConflict = latestBuilder.onConflictDoUpdate.mock.calls[0][0];
    expect(latestConflict.set).toEqual(
      expect.objectContaining({
        published_at: new Date("2026-04-07T12:00:00Z"),
        last_metadata_seen_at: expect.anything(),
      }),
    );

    const usedBuilder = vi.mocked(db.insert).mock.results[2]?.value;
    expect(usedBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        package_id: "pkg-2",
        version: "7.0.0",
        last_used_at: new Date("2026-04-08T03:00:00Z"),
      }),
    );
  });

  it("canonicalizes used-version metadata before upserting package rows", async () => {
    vi.mocked(db.insert)
      .mockReturnValueOnce(q([{ id: "pkg-3" }]) as any)
      .mockReturnValueOnce(q([{ id: "used-3" }]) as any);

    await persistPackageUsedVersionMetadata({
      ecosystem: " PyPI ",
      package: " My_Pkg.Name ",
      used_version: " 1.0.0 ",
      used_version_published_at: null,
      observed_at: "2026-04-08T04:00:00Z",
      latest_version: null,
      latest_published_at: null,
    });

    const packageBuilder = vi.mocked(db.insert).mock.results[0]?.value;
    expect(packageBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        ecosystem: "pypi",
        package: "my-pkg-name",
      }),
    );

    const versionBuilder = vi.mocked(db.insert).mock.results[1]?.value;
    expect(versionBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        version: "1.0.0",
      }),
    );
  });

  it("ignores used-version metadata when identity or observed timestamp is invalid", async () => {
    await persistPackageUsedVersionMetadata({
      ecosystem: "npm",
      package: "pkg",
      used_version: "   ",
      used_version_published_at: null,
      observed_at: "2026-04-08T04:00:00Z",
      latest_version: null,
      latest_published_at: null,
    });
    await persistPackageUsedVersionMetadata({
      ecosystem: "npm",
      package: "pkg",
      used_version: "1.0.0",
      used_version_published_at: null,
      observed_at: "not-a-date",
      latest_version: null,
      latest_published_at: null,
    });

    expect(vi.mocked(db.transaction)).not.toHaveBeenCalled();
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });
});
