export type PackageIdentityInput = {
  ecosystem: string;
  package: string;
  version?: string | null;
};

export type CanonicalPackageIdentity = {
  ecosystem: string;
  package: string;
  version: string | null;
};

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

export function canonicalizeOptionalPackageVersion(
  version: string | null | undefined,
): string | null {
  const canonicalVersion = canonicalizePackageVersion(version ?? "");
  return canonicalVersion === "" ? null : canonicalVersion;
}

export function canonicalizePackageIdentity(
  input: PackageIdentityInput,
): CanonicalPackageIdentity {
  const ecosystem = canonicalizeEcosystem(input.ecosystem);

  return {
    ecosystem,
    package: canonicalizePackageName(ecosystem, input.package),
    version: canonicalizeOptionalPackageVersion(input.version),
  };
}

export function parsePackageRef(
  packageRef: string,
): PackageIdentityInput | null {
  const firstSeparator = packageRef.indexOf(":");
  if (firstSeparator === -1) return null;

  const lastSeparator = packageRef.lastIndexOf(":");
  const ecosystem = packageRef.slice(0, firstSeparator);

  if (lastSeparator === firstSeparator) {
    return {
      ecosystem,
      package: packageRef.slice(firstSeparator + 1),
      version: null,
    };
  }

  return {
    ecosystem,
    package: packageRef.slice(firstSeparator + 1, lastSeparator),
    version: packageRef.slice(lastSeparator + 1),
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
