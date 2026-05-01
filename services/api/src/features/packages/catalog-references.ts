import type { DB } from "../../db/index.js";
import { packages, package_versions } from "../../db/schema.js";
import {
  canonicalizePackageIdentity,
  packageKey,
  packageVersionKey,
  type PackageIdentityInput,
} from "./identity.js";

export type PackageCatalogReference = {
  package_id: string | null;
  package_version_id: string | null;
};

export async function resolvePackageCatalogReferences(
  dbHandle: DB,
  inputs: PackageIdentityInput[],
): Promise<PackageCatalogReference[]> {
  const identities = inputs.map(canonicalizePackageIdentity);
  const packageValues = [
    ...new Map(
      identities
        .filter((identity) => identity.ecosystem && identity.package)
        .map((identity) => [
          packageKey(identity),
          { ecosystem: identity.ecosystem, package: identity.package },
        ]),
    ).values(),
  ];

  if (packageValues.length === 0) {
    return identities.map(() => ({
      package_id: null,
      package_version_id: null,
    }));
  }

  const packageRows = await dbHandle
    .insert(packages)
    .values(packageValues)
    .onConflictDoUpdate({
      target: [packages.ecosystem, packages.package],
      set: { updated_at: packages.updated_at },
    })
    .returning({
      id: packages.id,
      ecosystem: packages.ecosystem,
      package: packages.package,
    });

  const packageIdMap = new Map(
    packageRows.map((row) => [packageKey(row), row.id]),
  );

  const versionValues = [
    ...new Map(
      identities
        .map((identity) => {
          const package_id = packageIdMap.get(packageKey(identity));
          if (!package_id || !identity.version) return null;
          return {
            key: packageVersionKey(package_id, identity.version),
            value: { package_id, version: identity.version },
          };
        })
        .filter(
          (
            entry,
          ): entry is {
            key: string;
            value: { package_id: string; version: string };
          } => entry !== null,
        )
        .map((entry) => [entry.key, entry.value]),
    ).values(),
  ];

  const packageVersionRows =
    versionValues.length > 0
      ? await dbHandle
          .insert(package_versions)
          .values(versionValues)
          .onConflictDoUpdate({
            target: [package_versions.package_id, package_versions.version],
            set: { updated_at: package_versions.updated_at },
          })
          .returning({
            id: package_versions.id,
            package_id: package_versions.package_id,
            version: package_versions.version,
          })
      : [];

  const packageVersionIdMap = new Map(
    packageVersionRows.map((row) => [
      packageVersionKey(row.package_id, row.version),
      row.id,
    ]),
  );

  return identities.map((identity) => {
    const package_id = packageIdMap.get(packageKey(identity)) ?? null;
    const package_version_id =
      package_id && identity.version
        ? (packageVersionIdMap.get(
            packageVersionKey(package_id, identity.version),
          ) ?? null)
        : null;

    return { package_id, package_version_id };
  });
}
