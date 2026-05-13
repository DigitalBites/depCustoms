import { and, eq, sql } from "drizzle-orm";
import type { ConnectorFinding } from "../../connectors/types.js";
import type { DB } from "../../db/index.js";
import { VALID_TO_INFINITY_SQL } from "../../db/schema/shared.js";
import {
  findings,
  finding_versions,
  project_findings,
} from "../../db/schema.js";

function materialFindingPayload(finding: ConnectorFinding) {
  return {
    severity: finding.severity,
    title: finding.title,
    description: (finding.attributes.description as string | undefined) ?? null,
    aliases: finding.attributes.aliases ?? null,
    affected_ranges: finding.attributes.affected_ranges ?? null,
    fixed_versions:
      finding.attributes.fixed_versions ??
      finding.attributes.fix_versions ??
      (finding.attributes.fix_version
        ? [finding.attributes.fix_version]
        : null),
    raw_attributes: finding.attributes,
  };
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  return JSON.stringify(
    value,
    Object.keys(value as Record<string, unknown>).sort(),
  );
}

function hasMaterialChange(
  current: typeof finding_versions.$inferSelect,
  next: ReturnType<typeof materialFindingPayload>,
): boolean {
  return (
    current.severity !== next.severity ||
    current.title !== next.title ||
    current.description !== next.description ||
    stableJson(current.aliases) !== stableJson(next.aliases) ||
    stableJson(current.affected_ranges) !== stableJson(next.affected_ranges) ||
    stableJson(current.fixed_versions) !== stableJson(next.fixed_versions) ||
    stableJson(current.raw_attributes) !== stableJson(next.raw_attributes)
  );
}

function dateAfterNowAnd(value?: Date | null): Date {
  const now = new Date();
  if (!value || now.getTime() > value.getTime()) return now;
  return new Date(value.getTime() + 1);
}

type UpsertProjectFindingsInput = {
  tenantId: string;
  projectId: string;
  connectorKey: string;
  connectorCacheId?: string | null;
  packageId: string | null;
  packageVersionId: string | null;
  findings: ConnectorFinding[];
};

export async function upsertProjectFindingsForEntity(
  dbHandle: DB,
  input: UpsertProjectFindingsInput,
) {
  return dbHandle.transaction((tx) => upsertProjectFindingsForEntityTx(tx, input));
}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

async function upsertProjectFindingsForEntityTx(
  dbHandle: Tx,
  input: UpsertProjectFindingsInput,
) {
  const {
    tenantId,
    projectId,
    connectorKey,
    connectorCacheId,
    packageId,
    packageVersionId,
    findings: connectorFindings,
  } = input;

  if (!packageId) {
    return { newFindings: 0 };
  }

  let newFindings = 0;
  const observedFindingKeys = new Set<string>();

  for (const connectorFinding of connectorFindings) {
    const [findingIdentity] = await dbHandle
      .insert(findings)
      .values({
        connector_key: connectorKey,
        external_finding_id: connectorFinding.findingId,
      })
      .onConflictDoUpdate({
        target: [findings.connector_key, findings.external_finding_id],
        set: {
          external_finding_id: connectorFinding.findingId,
        },
      })
      .returning();
    if (!findingIdentity) throw new Error("finding_upsert_failed");
    observedFindingKeys.add(findingIdentity.finding_key);

    await dbHandle.execute(
      sql`select pg_advisory_xact_lock(hashtext(${findingIdentity.finding_key}))`,
    );

    const material = materialFindingPayload(connectorFinding);
    const [currentVersion] = await dbHandle
      .select()
      .from(finding_versions)
      .where(
        and(
          eq(finding_versions.finding_key, findingIdentity.finding_key),
          eq(finding_versions.effective_to, VALID_TO_INFINITY_SQL),
        ),
      )
      .limit(1);

    const versionObservedAt = dateAfterNowAnd(currentVersion?.effective_from);
    let version = currentVersion;
    if (!currentVersion || hasMaterialChange(currentVersion, material)) {
      const nextVersionNumber = (currentVersion?.version ?? 0) + 1;
      if (currentVersion) {
        await dbHandle
          .update(finding_versions)
          .set({ effective_to: versionObservedAt })
          .where(eq(finding_versions.id, currentVersion.id));
      }

      const [createdVersion] = await dbHandle
        .insert(finding_versions)
        .values({
          finding_key: findingIdentity.finding_key,
          version: nextVersionNumber,
          connector_cache_id: connectorCacheId ?? null,
          severity: material.severity,
          title: material.title,
          description: material.description,
          aliases: material.aliases,
          affected_ranges: material.affected_ranges,
          fixed_versions: material.fixed_versions,
          raw_attributes: material.raw_attributes,
          effective_from: versionObservedAt,
        })
        .returning();
      if (!createdVersion) throw new Error("finding_version_create_failed");

      if (currentVersion) {
        await dbHandle
          .update(finding_versions)
          .set({ superseded_by_id: createdVersion.id })
          .where(eq(finding_versions.id, currentVersion.id));
      }
      version = createdVersion;
    }

    const [currentProjectFinding] = await dbHandle
      .select()
      .from(project_findings)
      .where(
        and(
          eq(project_findings.project_id, projectId),
          eq(project_findings.package_id, packageId),
          packageVersionId
            ? eq(project_findings.package_version_id, packageVersionId)
            : sql`${project_findings.package_version_id} IS NULL`,
          eq(project_findings.finding_key, findingIdentity.finding_key),
          eq(project_findings.observed_to, VALID_TO_INFINITY_SQL),
        ),
      )
      .limit(1);

    const projectObservedAt = dateAfterNowAnd(currentProjectFinding?.observed_from);
    if (!currentProjectFinding) {
      newFindings++;
      await dbHandle.insert(project_findings).values({
        tenant_id: tenantId,
        project_id: projectId,
        package_id: packageId,
        package_version_id: packageVersionId,
        finding_key: findingIdentity.finding_key,
        current_finding_version_id: version.id,
        observed_from: projectObservedAt,
        last_seen_at: projectObservedAt,
      });
    } else {
      await dbHandle
        .update(project_findings)
        .set({
          current_finding_version_id: version.id,
          last_seen_at: projectObservedAt,
        })
        .where(eq(project_findings.id, currentProjectFinding.id));
    }
  }

  const currentProjectFindings = await dbHandle
    .select({
      id: project_findings.id,
      finding_key: project_findings.finding_key,
      observed_from: project_findings.observed_from,
    })
    .from(project_findings)
    .innerJoin(findings, eq(project_findings.finding_key, findings.finding_key))
    .where(
      and(
        eq(project_findings.project_id, projectId),
        eq(project_findings.package_id, packageId),
        packageVersionId
          ? eq(project_findings.package_version_id, packageVersionId)
          : sql`${project_findings.package_version_id} IS NULL`,
        eq(findings.connector_key, connectorKey),
        eq(project_findings.observed_to, VALID_TO_INFINITY_SQL),
      ),
    );

  for (const currentProjectFinding of currentProjectFindings) {
    if (observedFindingKeys.has(currentProjectFinding.finding_key)) continue;

    await dbHandle
      .update(project_findings)
      .set({ observed_to: dateAfterNowAnd(currentProjectFinding.observed_from) })
      .where(eq(project_findings.id, currentProjectFinding.id));
  }

  return { newFindings };
}
