import type { DB } from "../../db/index.js";
import type { db } from "../../db/index.js";
import {
  canonicalizePackageIdentity,
  type CanonicalPackageIdentity,
  type PackageIdentityInput,
} from "./identity.js";
import {
  resolvePackageCatalogReferences,
  type PackageCatalogReference,
} from "./catalog-references.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ArtifactIdentityDb = Pick<DB, "insert"> | Pick<Tx, "insert">;

export type ArtifactIdentityScope = "package" | "package_version";

export type RawArtifactIdentity = {
  ecosystem: string;
  package: string;
  version: string | null;
  source: string;
  parser_version: string;
};

export type ArtifactIdentityInput = PackageIdentityInput & {
  source?: string;
  parser_version?: string;
};

export type ArtifactIdentity = CanonicalPackageIdentity &
  PackageCatalogReference & {
    scope: ArtifactIdentityScope;
    canonical_ref: string;
    display_name: string;
    raw: RawArtifactIdentity;
  };

export const DEFAULT_ARTIFACT_IDENTITY_PARSER_VERSION =
  "artifact-identity-v1";

export function buildArtifactCanonicalRef(
  identity: CanonicalPackageIdentity,
): string {
  return identity.version
    ? `${identity.ecosystem}:${identity.package}:${identity.version}`
    : `${identity.ecosystem}:${identity.package}`;
}

export function buildArtifactDisplayName(
  identity: CanonicalPackageIdentity,
): string {
  return identity.version
    ? `${identity.ecosystem}:${identity.package}@${identity.version}`
    : `${identity.ecosystem}:${identity.package}`;
}

export function buildRawArtifactIdentity(
  input: ArtifactIdentityInput,
): RawArtifactIdentity {
  return {
    ecosystem: input.ecosystem,
    package: input.package,
    version: input.version ?? null,
    source: input.source ?? "unknown",
    parser_version:
      input.parser_version ?? DEFAULT_ARTIFACT_IDENTITY_PARSER_VERSION,
  };
}

export function buildArtifactIdentity(
  input: ArtifactIdentityInput,
  catalogReference: PackageCatalogReference = {
    package_id: null,
    package_version_id: null,
  },
): ArtifactIdentity {
  const identity = canonicalizePackageIdentity(input);

  return {
    ...identity,
    scope: identity.version ? "package_version" : "package",
    ...catalogReference,
    canonical_ref: buildArtifactCanonicalRef(identity),
    display_name: buildArtifactDisplayName(identity),
    raw: buildRawArtifactIdentity(input),
  };
}

export async function resolveArtifactIdentities(
  dbHandle: ArtifactIdentityDb,
  inputs: ArtifactIdentityInput[],
): Promise<ArtifactIdentity[]> {
  const catalogReferences = await resolvePackageCatalogReferences(
    dbHandle,
    inputs,
  );

  return inputs.map((input, index) =>
    buildArtifactIdentity(input, catalogReferences[index]),
  );
}

export async function resolveArtifactIdentity(
  dbHandle: ArtifactIdentityDb,
  input: ArtifactIdentityInput,
): Promise<ArtifactIdentity> {
  const [identity] = await resolveArtifactIdentities(dbHandle, [input]);
  return identity ?? buildArtifactIdentity(input);
}
