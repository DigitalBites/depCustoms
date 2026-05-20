import {
  ARTIFACT_KIND,
  DISPLAY_ROLE,
  ECOSYSTEM,
  PACKAGE_VERSION_REF_KIND,
  VERSION_KIND,
} from "@customs/shared-constants";
import type {
  ArtifactKind,
  DisplayRole,
  PackageVersionRefKind,
  VersionKind,
} from "@customs/shared-constants";
import type { PackageIdentityInput } from "./identity.js";

export type PackageCatalogClassification = {
  version_kind: VersionKind;
  artifact_kind: ArtifactKind;
  display_role: DisplayRole;
};

export type ObservedRefClassification = {
  ref_kind: PackageVersionRefKind;
  is_display_preferred: boolean;
};

type EcosystemCatalogClassifier = {
  classifyVersion(input: PackageIdentityInput): PackageCatalogClassification;
  classifyObservedRef(input: { ref: string }): ObservedRefClassification;
};

function isDigestReference(value: string | null | undefined): boolean {
  return value?.trim().startsWith("sha256:") ?? false;
}

const defaultCatalogClassification: PackageCatalogClassification = {
  version_kind: VERSION_KIND.VERSION,
  artifact_kind: ARTIFACT_KIND.PACKAGE_RELEASE,
  display_role: DISPLAY_ROLE.PRIMARY,
};

const defaultObservedRefClassification: ObservedRefClassification = {
  ref_kind: PACKAGE_VERSION_REF_KIND.ALIAS,
  is_display_preferred: false,
};

const catalogClassifiers: Partial<Record<string, EcosystemCatalogClassifier>> =
  {
    [ECOSYSTEM.DOCKER]: {
      classifyVersion(input) {
        return {
          version_kind: isDigestReference(input.version)
            ? VERSION_KIND.DIGEST
            : VERSION_KIND.VERSION,
          artifact_kind: ARTIFACT_KIND.DOCKER_INDEX,
          display_role: DISPLAY_ROLE.PRIMARY,
        };
      },
      classifyObservedRef(input) {
        const isDigest = isDigestReference(input.ref);
        return {
          ref_kind: isDigest
            ? PACKAGE_VERSION_REF_KIND.DIGEST
            : PACKAGE_VERSION_REF_KIND.TAG,
          is_display_preferred: !isDigest,
        };
      },
    },
  };

function classifierFor(ecosystem: string): EcosystemCatalogClassifier | null {
  return catalogClassifiers[ecosystem.trim().toLowerCase()] ?? null;
}

export function classifyPackageCatalogVersion(
  input: PackageIdentityInput,
): PackageCatalogClassification {
  return classifierFor(input.ecosystem)?.classifyVersion(input) ??
    defaultCatalogClassification;
}

export function classifyObservedPackageVersionRef(input: {
  ecosystem: string;
  ref: string;
}): ObservedRefClassification {
  return classifierFor(input.ecosystem)?.classifyObservedRef(input) ??
    defaultObservedRefClassification;
}
