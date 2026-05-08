import type { DB } from "../../db/index.js";
import type { db } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { packages, package_versions } from "../../db/schema.js";
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

export async function loadArtifactIdentityByCatalogIds(
  dbHandle: Pick<DB, "select">,
  input: {
    package_id: string | null;
    package_version_id: string | null;
    source?: string;
  },
): Promise<ArtifactIdentity | null> {
  if (input.package_version_id) {
    const [row] = await dbHandle
      .select({
        package_id: packages.id,
        package_version_id: package_versions.id,
        ecosystem: packages.ecosystem,
        package: packages.package,
        version: package_versions.version,
      })
      .from(package_versions)
      .innerJoin(packages, eq(packages.id, package_versions.package_id))
      .where(eq(package_versions.id, input.package_version_id))
      .limit(1);

    if (!row) return null;
    return buildArtifactIdentity(
      {
        ecosystem: row.ecosystem,
        package: row.package,
        version: row.version,
        source: input.source ?? "catalog",
      },
      {
        package_id: row.package_id,
        package_version_id: row.package_version_id,
      },
    );
  }

  if (!input.package_id) return null;

  const [row] = await dbHandle
    .select({
      package_id: packages.id,
      ecosystem: packages.ecosystem,
      package: packages.package,
    })
    .from(packages)
    .where(eq(packages.id, input.package_id))
    .limit(1);

  if (!row) return null;
  return buildArtifactIdentity(
    {
      ecosystem: row.ecosystem,
      package: row.package,
      version: null,
      source: input.source ?? "catalog",
    },
    {
      package_id: row.package_id,
      package_version_id: null,
    },
  );
}
