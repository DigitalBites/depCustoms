import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { packages, package_versions } from "../../db/schema.js";

type PackageLatestMetadataInput = {
  ecosystem: string;
  package: string;
  latest_version: string;
  latest_published_at: string | null;
  observed_at: string;
};

type PackageUsedVersionMetadataInput = {
  ecosystem: string;
  package: string;
  used_version: string;
  used_version_published_at: string | null;
  observed_at: string;
  latest_version: string | null;
  latest_published_at: string | null;
};

function parseTimestamp(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function upsertPackageIdentity(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    ecosystem: string;
    package: string;
    lastMetadataSeenAt?: Date;
    latestPackageVersionId?: string | null;
  },
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(packages)
    .values({
      ecosystem: input.ecosystem,
      package: input.package,
      ...(input.lastMetadataSeenAt
        ? { last_metadata_seen_at: input.lastMetadataSeenAt }
        : {}),
      ...(input.latestPackageVersionId !== undefined
        ? { latest_package_version_id: input.latestPackageVersionId }
        : {}),
    })
    .onConflictDoUpdate({
      target: [packages.ecosystem, packages.package],
      set: {
        ...(input.lastMetadataSeenAt
          ? { last_metadata_seen_at: input.lastMetadataSeenAt }
          : {}),
        ...(input.latestPackageVersionId !== undefined
          ? { latest_package_version_id: input.latestPackageVersionId }
          : {}),
        updated_at: sql`NOW()`,
      },
    })
    .returning({ id: packages.id });

  return row;
}

async function upsertPackageVersion(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    packageId: string;
    version: string;
    publishedAt?: Date | null;
    lastMetadataSeenAt?: Date;
    lastUsedAt?: Date;
  },
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(package_versions)
    .values({
      package_id: input.packageId,
      version: input.version,
      ...(input.publishedAt ? { published_at: input.publishedAt } : {}),
      ...(input.lastMetadataSeenAt
        ? { last_metadata_seen_at: input.lastMetadataSeenAt }
        : {}),
      ...(input.lastUsedAt ? { last_used_at: input.lastUsedAt } : {}),
    })
    .onConflictDoUpdate({
      target: [package_versions.package_id, package_versions.version],
      set: {
        ...(input.publishedAt ? { published_at: input.publishedAt } : {}),
        ...(input.lastMetadataSeenAt
          ? { last_metadata_seen_at: input.lastMetadataSeenAt }
          : {}),
        ...(input.lastUsedAt ? { last_used_at: input.lastUsedAt } : {}),
        updated_at: sql`NOW()`,
      },
    })
    .returning({ id: package_versions.id });

  return row;
}

async function ensureLatestVersion(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    ecosystem: string;
    package: string;
    latestVersion: string;
    latestPublishedAt: Date | null;
    observedAt: Date;
  },
): Promise<{ packageId: string; packageVersionId: string }> {
  const pkg = await upsertPackageIdentity(tx, {
    ecosystem: input.ecosystem,
    package: input.package,
    lastMetadataSeenAt: input.observedAt,
  });

  const latestVersion = await upsertPackageVersion(tx, {
    packageId: pkg.id,
    version: input.latestVersion,
    publishedAt: input.latestPublishedAt,
    lastMetadataSeenAt: input.observedAt,
  });

  await tx
    .update(packages)
    .set({
      latest_package_version_id: latestVersion.id,
      last_metadata_seen_at: input.observedAt,
      updated_at: sql`NOW()`,
    })
    .where(eq(packages.id, pkg.id));

  return { packageId: pkg.id, packageVersionId: latestVersion.id };
}

export async function persistPackageLatestMetadata(
  msg: PackageLatestMetadataInput,
): Promise<void> {
  const observedAt = new Date(msg.observed_at);
  const latestPublishedAt = parseTimestamp(msg.latest_published_at);

  await db.transaction(async (tx) => {
    await ensureLatestVersion(tx, {
      ecosystem: msg.ecosystem,
      package: msg.package,
      latestVersion: msg.latest_version,
      latestPublishedAt,
      observedAt,
    });
  });
}

export async function persistPackageUsedVersionMetadata(
  msg: PackageUsedVersionMetadataInput,
): Promise<void> {
  const observedAt = new Date(msg.observed_at);
  const usedVersionPublishedAt = parseTimestamp(msg.used_version_published_at);
  const latestPublishedAt = parseTimestamp(msg.latest_published_at);

  await db.transaction(async (tx) => {
    let packageId: string;

    if (msg.latest_version) {
      const latest = await ensureLatestVersion(tx, {
        ecosystem: msg.ecosystem,
        package: msg.package,
        latestVersion: msg.latest_version,
        latestPublishedAt,
        observedAt,
      });
      packageId = latest.packageId;
    } else {
      const pkg = await upsertPackageIdentity(tx, {
        ecosystem: msg.ecosystem,
        package: msg.package,
      });
      packageId = pkg.id;
    }

    await upsertPackageVersion(tx, {
      packageId,
      version: msg.used_version,
      publishedAt: usedVersionPublishedAt,
      lastUsedAt: observedAt,
    });
  });
}
