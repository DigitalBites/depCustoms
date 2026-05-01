export type PackageIdentityInput = {
  ecosystem: string;
  package: string;
  version: string;
};

export type CanonicalPackageIdentity = PackageIdentityInput;

export function canonicalizeEcosystem(ecosystem: string): string {
  return ecosystem.trim().toLowerCase();
}

export function canonicalizePackageName(
  ecosystem: string,
  packageName: string,
): string {
  const canonicalEcosystem = canonicalizeEcosystem(ecosystem);
  const trimmed = packageName.trim().toLowerCase();

  if (canonicalEcosystem === "pypi") {
    return trimmed.replace(/[-_.]+/g, "-");
  }

  return trimmed;
}

export function canonicalizePackageVersion(version: string): string {
  return version.trim();
}

export function canonicalizePackageIdentity(
  input: PackageIdentityInput,
): CanonicalPackageIdentity {
  const ecosystem = canonicalizeEcosystem(input.ecosystem);

  return {
    ecosystem,
    package: canonicalizePackageName(ecosystem, input.package),
    version: canonicalizePackageVersion(input.version),
  };
}

export function packageKey(
  input: Pick<PackageIdentityInput, "ecosystem" | "package">,
): string {
  return `${canonicalizeEcosystem(input.ecosystem)}|${canonicalizePackageName(
    input.ecosystem,
    input.package,
  )}`;
}

export function packageVersionKey(packageId: string, version: string): string {
  return `${packageId}|${canonicalizePackageVersion(version)}`;
}
