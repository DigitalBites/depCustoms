import {
  DISPLAY_ROLE,
  PACKAGE_VERSION_REF_KIND,
  PACKAGE_VERSION_REF_SOURCE,
  PACKAGE_VERSION_METADATA_KIND,
} from "@customs/shared-constants";
import type {
  ArtifactKind,
  DisplayRole,
  PackageVersionMetadataKind,
  PackageVersionRefKind,
  PackageVersionRefSource,
  PackageVersionRelationshipType,
  VersionKind,
} from "@customs/shared-constants";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../../db/index.js";
import type { db } from "../../db/index.js";
import {
  packages,
  package_version_metadata,
  package_version_refs,
  package_version_relationships,
  package_versions,
} from "../../db/schema.js";
import {
  canonicalizePackageIdentity,
  packageKey,
  packageVersionKey,
  parsePackageRef,
  type PackageIdentityInput,
} from "./identity.js";
import {
  classifyObservedPackageVersionRef,
  classifyPackageCatalogVersion,
} from "./catalog-classification.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CatalogDb = Pick<DB, "insert"> | Pick<Tx, "insert">;
type CatalogWriteDb =
  | Pick<DB, "insert" | "update">
  | Pick<Tx, "insert" | "update">;

export type PackageCatalogReference = {
  package_id: string | null;
  package_version_id: string | null;
};

export type PackageCatalogReferenceInput = PackageIdentityInput & {
  version_kind?: VersionKind;
  artifact_kind?: ArtifactKind;
  display_role?: DisplayRole;
};

export type PackageVersionRefInput = {
  package_id: string;
  package_version_id: string;
  ref: string;
  ref_kind: PackageVersionRefKind;
  source: PackageVersionRefSource;
  is_display_preferred?: boolean;
  metadata?: unknown;
  observed_at?: Date;
};

export type PackageVersionMetadataInput = {
  package_version_id: string;
  metadata_kind: PackageVersionMetadataKind;
  data: unknown;
  observed_at?: Date;
};

export type PackageVersionRelationshipInput = {
  parent_package_version_id: string;
  child_package_version_id: string;
  relationship_type: PackageVersionRelationshipType;
  observed_at?: Date;
};

export type PackageVersionRelatedVersionInput = {
  version: string;
  version_kind: VersionKind;
  artifact_kind: ArtifactKind;
  display_role: DisplayRole;
  relationship_type: PackageVersionRelationshipType;
  media_type?: string | null;
  size_bytes?: number | bigint | null;
  platform_os?: string | null;
  platform_arch?: string | null;
  platform_variant?: string | null;
  metadata_json?: string | null;
};

function catalogReferenceDefaults(input: PackageCatalogReferenceInput) {
  const classified = classifyPackageCatalogVersion(input);
  return {
    version_kind: input.version_kind ?? classified.version_kind,
    artifact_kind: input.artifact_kind ?? classified.artifact_kind,
    display_role: input.display_role ?? classified.display_role,
  };
}

export async function resolvePackageCatalogReferences(
  dbHandle: CatalogDb,
  inputs: PackageCatalogReferenceInput[],
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
    packageRows
      .filter(
        (row): row is { id: string; ecosystem: string; package: string } =>
          typeof row.ecosystem === "string" &&
          typeof row.package === "string",
      )
      .map((row) => [packageKey(row), row.id]),
  );

  const versionValues = [
    ...new Map(
      identities
        .map((identity, index) => {
          const package_id = packageIdMap.get(packageKey(identity));
          if (!package_id || !identity.version) return null;
          const defaults = catalogReferenceDefaults(inputs[index] ?? identity);
          return {
            key: packageVersionKey(package_id, identity.version),
            value: {
              package_id,
              version: identity.version,
              version_kind: defaults.version_kind,
              artifact_kind: defaults.artifact_kind,
              display_role: defaults.display_role,
            },
          };
        })
        .filter(
          (
            entry,
          ): entry is {
            key: string;
            value: {
              package_id: string;
              version: string;
              version_kind: VersionKind;
              artifact_kind: ArtifactKind;
              display_role: DisplayRole;
            };
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
            set: {
              version_kind: sql`excluded.version_kind`,
              artifact_kind: sql`
                CASE
                  WHEN ${package_versions.display_role} IN (${DISPLAY_ROLE.CHILD}, ${DISPLAY_ROLE.INTERNAL})
                    AND excluded.display_role = ${DISPLAY_ROLE.PRIMARY}
                  THEN ${package_versions.artifact_kind}
                  ELSE excluded.artifact_kind
                END
              `,
              display_role: sql`
                CASE
                  WHEN ${package_versions.display_role} IN (${DISPLAY_ROLE.CHILD}, ${DISPLAY_ROLE.INTERNAL})
                    AND excluded.display_role = ${DISPLAY_ROLE.PRIMARY}
                  THEN ${package_versions.display_role}
                  ELSE excluded.display_role
                END
              `,
              updated_at: sql`NOW()`,
            },
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

export async function resolvePackageCatalogReferenceForPackageRef(
  dbHandle: CatalogDb,
  packageRef: string,
): Promise<PackageCatalogReference> {
  const identity = parsePackageRef(packageRef);
  if (!identity) {
    return { package_id: null, package_version_id: null };
  }

  const [catalogReference] = await resolvePackageCatalogReferences(dbHandle, [
    identity,
  ]);

  return catalogReference ?? { package_id: null, package_version_id: null };
}

export async function upsertPackageVersionRef(
  dbHandle: CatalogWriteDb,
  input: PackageVersionRefInput,
): Promise<void> {
  const ref = input.ref.trim();
  if (!ref) return;
  const observedAt = input.observed_at ?? new Date();

  if (input.is_display_preferred) {
    await dbHandle
      .update(package_version_refs)
      .set({ is_display_preferred: false, updated_at: sql`NOW()` })
      .where(
        and(
          eq(package_version_refs.package_version_id, input.package_version_id),
          eq(package_version_refs.is_display_preferred, true),
        ),
      );
  }

  await dbHandle
    .insert(package_version_refs)
    .values({
      package_id: input.package_id,
      package_version_id: input.package_version_id,
      ref,
      ref_kind: input.ref_kind,
      source: input.source,
      is_display_preferred: input.is_display_preferred ?? false,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      first_seen_at: observedAt,
      last_seen_at: observedAt,
    })
    .onConflictDoUpdate({
      target: [
        package_version_refs.package_id,
        package_version_refs.ref,
        package_version_refs.ref_kind,
        package_version_refs.package_version_id,
        package_version_refs.source,
      ],
      set: {
        is_display_preferred: input.is_display_preferred ?? false,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        first_seen_at: sql`LEAST(${package_version_refs.first_seen_at}, ${observedAt.toISOString()}::timestamptz)`,
        last_seen_at: sql`GREATEST(${package_version_refs.last_seen_at}, ${observedAt.toISOString()}::timestamptz)`,
        updated_at: sql`NOW()`,
      },
    });
}

export async function upsertPackageVersionMetadata(
  dbHandle: CatalogWriteDb,
  input: PackageVersionMetadataInput,
): Promise<void> {
  await dbHandle
    .insert(package_version_metadata)
    .values({
      package_version_id: input.package_version_id,
      metadata_kind: input.metadata_kind,
      data: input.data,
      ...(input.observed_at ? { observed_at: input.observed_at } : {}),
    })
    .onConflictDoUpdate({
      target: [
        package_version_metadata.package_version_id,
        package_version_metadata.metadata_kind,
      ],
      set: {
        data: input.data,
        ...(input.observed_at
          ? {
              observed_at: sql`GREATEST(COALESCE(${package_version_metadata.observed_at}, '-infinity'::timestamptz), ${input.observed_at.toISOString()}::timestamptz)`,
            }
          : {}),
        updated_at: sql`NOW()`,
      },
    });
}

export async function upsertPackageVersionRelationship(
  dbHandle: CatalogWriteDb,
  input: PackageVersionRelationshipInput,
): Promise<void> {
  await dbHandle
    .insert(package_version_relationships)
    .values({
      parent_package_version_id: input.parent_package_version_id,
      child_package_version_id: input.child_package_version_id,
      relationship_type: input.relationship_type,
      ...(input.observed_at ? { observed_at: input.observed_at } : {}),
    })
    .onConflictDoUpdate({
      target: [
        package_version_relationships.parent_package_version_id,
        package_version_relationships.child_package_version_id,
        package_version_relationships.relationship_type,
      ],
      set: {
        ...(input.observed_at
          ? {
              observed_at: sql`GREATEST(COALESCE(${package_version_relationships.observed_at}, '-infinity'::timestamptz), ${input.observed_at.toISOString()}::timestamptz)`,
            }
          : {}),
        updated_at: sql`NOW()`,
      },
    });
}

export async function recordObservedPackageVersionRefs(
  dbHandle: CatalogWriteDb,
  input: {
    ecosystem: string;
    package_id: string | null;
    package_version_id: string | null;
    version: string | null;
    requested_ref?: string | null;
    resolved_ref?: string | null;
    ref_resolution_source?: string | null;
    observed_at?: Date;
  },
): Promise<void> {
  if (!input.package_id || !input.package_version_id) return;
  const observedAt = input.observed_at ?? new Date();

  if (input.version) {
    await upsertPackageVersionRef(dbHandle, {
      package_id: input.package_id,
      package_version_id: input.package_version_id,
      ref: input.version,
      ref_kind: input.version.startsWith("sha256:")
        ? PACKAGE_VERSION_REF_KIND.DIGEST
        : PACKAGE_VERSION_REF_KIND.VERSION,
      source: PACKAGE_VERSION_REF_SOURCE.PROXY,
      observed_at: observedAt,
    });
  }

  const requestedRef = input.requested_ref?.trim();
  if (!requestedRef || requestedRef === input.version) return;
  const refClassification = classifyObservedPackageVersionRef({
    ecosystem: input.ecosystem,
    ref: requestedRef,
  });

  await upsertPackageVersionRef(dbHandle, {
    package_id: input.package_id,
    package_version_id: input.package_version_id,
    ref: requestedRef,
    ref_kind: refClassification.ref_kind,
    source: PACKAGE_VERSION_REF_SOURCE.PROXY,
    is_display_preferred: refClassification.is_display_preferred,
    metadata: {
      resolved_ref: input.resolved_ref ?? input.version,
      ref_resolution_source: input.ref_resolution_source ?? null,
    },
    observed_at: observedAt,
  });

  await upsertPackageVersionMetadata(dbHandle, {
    package_version_id: input.package_version_id,
    metadata_kind: PACKAGE_VERSION_METADATA_KIND.REGISTRY_METADATA,
    data: {
      ecosystem: input.ecosystem.trim().toLowerCase(),
      requested_ref: requestedRef,
      resolved_ref: input.resolved_ref ?? input.version,
      ref_resolution_source: input.ref_resolution_source ?? null,
    },
    observed_at: observedAt,
  });
}

function parseMetadataJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { raw: value };
  }
}

export async function recordPackageVersionRelatedVersions(
  dbHandle: CatalogWriteDb,
  input: {
    ecosystem: string;
    package: string;
    package_id: string | null;
    package_version_id: string | null;
    related_versions?: PackageVersionRelatedVersionInput[];
    observed_at?: Date;
  },
): Promise<void> {
  if (
    !input.package_id ||
    !input.package_version_id ||
    !input.related_versions?.length
  ) {
    return;
  }

  const observedAt = input.observed_at ?? new Date();
  for (const related of input.related_versions) {
    const version = related.version.trim();
    if (!version || !related.relationship_type) continue;

    const [child] = await resolvePackageCatalogReferences(dbHandle, [
      {
        ecosystem: input.ecosystem,
        package: input.package,
        version,
        version_kind: related.version_kind,
        artifact_kind: related.artifact_kind,
        display_role: related.display_role,
      },
    ]);
    if (!child?.package_id || !child.package_version_id) continue;

    await upsertPackageVersionRef(dbHandle, {
      package_id: child.package_id,
      package_version_id: child.package_version_id,
      ref: version,
      ref_kind: PACKAGE_VERSION_REF_KIND.DIGEST,
      source: PACKAGE_VERSION_REF_SOURCE.PROXY,
      observed_at: observedAt,
    });

    await upsertPackageVersionRelationship(dbHandle, {
      parent_package_version_id: input.package_version_id,
      child_package_version_id: child.package_version_id,
      relationship_type: related.relationship_type,
      observed_at: observedAt,
    });

    await upsertPackageVersionMetadata(dbHandle, {
      package_version_id: child.package_version_id,
      metadata_kind: PACKAGE_VERSION_METADATA_KIND.DESCRIPTOR,
      data: {
        media_type: related.media_type ?? null,
        size_bytes:
          related.size_bytes === null || related.size_bytes === undefined
            ? null
            : Number(related.size_bytes),
        metadata: parseMetadataJson(related.metadata_json),
      },
      observed_at: observedAt,
    });

    if (
      related.platform_os ||
      related.platform_arch ||
      related.platform_variant
    ) {
      await upsertPackageVersionMetadata(dbHandle, {
        package_version_id: child.package_version_id,
        metadata_kind: PACKAGE_VERSION_METADATA_KIND.PLATFORM,
        data: {
          os: related.platform_os ?? null,
          arch: related.platform_arch ?? null,
          variant: related.platform_variant ?? null,
        },
        observed_at: observedAt,
      });
    }
  }
}
