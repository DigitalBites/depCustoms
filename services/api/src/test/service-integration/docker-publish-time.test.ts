import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { package_versions, packages, tenants } from "../../db/schema.js";
import { handleRecordPackageUsedVersionMetadata } from "../../connect/record-package-used-version-metadata-service.js";
import type { VerifiedProxyContext } from "../../connect/proxy-context.js";

const PACKAGE = "hub.docker.io/library/redis";
const DIGEST = "sha256:11111111111111111111111111111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function makeProxy(): VerifiedProxyContext {
  return {
    proxyId: randomUUID(),
    tenantId: randomUUID(),
    proxyIp: "127.0.0.1",
  };
}

async function cleanupPackage(): Promise<void> {
  const [pkg] = await db
    .select({ id: packages.id })
    .from(packages)
    .where(and(eq(packages.ecosystem, "docker"), eq(packages.package, PACKAGE)))
    .limit(1);
  if (!pkg) return;
  await db
    .delete(package_versions)
    .where(eq(package_versions.package_id, pkg.id));
  await db.delete(packages).where(eq(packages.id, pkg.id));
}

describe("docker hub digest-gated publish time persistence", () => {
  afterEach(async () => {
    await cleanupPackage();
  });

  it("persists the verified publish time when the proxy supplies it", async () => {
    const tenantId = randomUUID();
    await db.insert(tenants).values({ id: tenantId, name: `it-${tenantId.slice(0, 8)}` });
    const proxy = { ...makeProxy(), tenantId };

    try {
      await handleRecordPackageUsedVersionMetadata(proxy, {
        ecosystem: "docker",
        package: PACKAGE,
        used_version: DIGEST,
        used_version_published_at: "2024-08-20T10:00:00Z",
        observed_at: "2024-08-20T12:00:00Z",
        cache_status: "miss",
        latest_version: null,
        latest_published_at: null,
      });

      const [pkg] = await db
        .select({ id: packages.id })
        .from(packages)
        .where(and(eq(packages.ecosystem, "docker"), eq(packages.package, PACKAGE)))
        .limit(1);
      expect(pkg).toBeDefined();

      const [version] = await db
        .select({
          version: package_versions.version,
          publishedAt: package_versions.published_at,
        })
        .from(package_versions)
        .where(eq(package_versions.package_id, pkg!.id))
        .limit(1);

      expect(version?.version).toBe(DIGEST);
      expect(version?.publishedAt?.toISOString()).toBe("2024-08-20T10:00:00.000Z");
    } finally {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
  });

  it("persists a null publish time when the proxy withholds it (digest mismatch)", async () => {
    const tenantId = randomUUID();
    await db.insert(tenants).values({ id: tenantId, name: `it-${tenantId.slice(0, 8)}` });
    const proxy = { ...makeProxy(), tenantId };

    try {
      await handleRecordPackageUsedVersionMetadata(proxy, {
        ecosystem: "docker",
        package: PACKAGE,
        used_version: DIGEST,
        used_version_published_at: null,
        observed_at: "2024-08-20T12:00:00Z",
        cache_status: "miss",
        latest_version: null,
        latest_published_at: null,
      });

      const [pkg] = await db
        .select({ id: packages.id })
        .from(packages)
        .where(and(eq(packages.ecosystem, "docker"), eq(packages.package, PACKAGE)))
        .limit(1);
      expect(pkg).toBeDefined();

      const [version] = await db
        .select({
          version: package_versions.version,
          publishedAt: package_versions.published_at,
        })
        .from(package_versions)
        .where(eq(package_versions.package_id, pkg!.id))
        .limit(1);

      expect(version?.version).toBe(DIGEST);
      expect(version?.publishedAt).toBeNull();
    } finally {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
  });
});
