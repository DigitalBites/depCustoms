import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  policies,
  projects,
  rules,
  violation_occurrences,
  violations,
} from "../../db/schema.js";
import {
  getAuthContext,
  listAccessibleProjectIds,
  requireProjectAccess,
  requireTenantCapability,
  requireTenantCapabilityAccess,
} from "../../http/guards.js";
import { canPerform, isTenantRole } from "../../middleware/rbac.js";
import { paginationQuerySchema } from "../../http/validation.js";
import { loadProjectPackageFindingContext } from "../security/package-finding-context.js";
import { loadTenantPackageContext } from "../security/tenant-package-shared.js";
import {
  loadProjectPackageEvidence,
  loadTenantPackageEvidence,
} from "../security/finding-package-queries.js";

const entityStatusSchema = z
  .enum(["all", "open", "resolved", "suppressed"])
  .optional();

const querySchema = paginationQuerySchema(50, 200).extend({
  status: entityStatusSchema,
});

type EntitySummaryRow = {
  package_version_id: string;
  package_id: string;
  ecosystem: string;
  name: string;
  version: string;
  latest_evaluated_at: Date | string;
  open_count: string | number;
  resolved_count: string | number;
  suppressed_count: string | number;
  blocked_open_count: string | number;
  advisory_open_count: string | number;
  total_count: string | number;
};

type ViolationRow = Omit<
  typeof violations.$inferSelect,
  | "package_id_key"
  | "package_version_id_key"
  | "policy_id_key"
  | "rule_id_key"
  | "policy_rule_binding_id_key"
  | "policy_project_binding_id_key"
  | "policy_rule_binding_id"
  | "policy_project_binding_id"
  | "status_updated_by"
  | "status_updated_at"
> & {
  project_name?: string | null;
  rule_name?: string | null;
  policy_name?: string | null;
  policy_rule_binding_id?: string | null;
  policy_project_binding_id?: string | null;
  status_updated_by?: string | null;
  status_updated_at?: Date | null;
  occurrence_count?: number | string | null;
};

type EntityStatusFilter = "all" | "open" | "resolved" | "suppressed";

export const projectViolationEntityRouter = new Hono();
export const tenantViolationEntityRouter = new Hono();

function canReadContributor(c: Parameters<typeof getAuthContext>[0]): boolean {
  const role = c.get("role");
  return isTenantRole(role) && canPerform(role, "connectors.read");
}

function severityRank(severity: string) {
  switch (severity) {
    case "CRITICAL":
      return 4;
    case "HIGH":
      return 3;
    case "MEDIUM":
      return 2;
    case "LOW":
      return 1;
    default:
      return 0;
  }
}

function buildResponse(
  summaries: EntitySummaryRow[],
  violationRows: ViolationRow[],
  evidenceByPackageVersion: Map<string, unknown>,
) {
  const violationsByEntity = new Map<string, ViolationRow[]>();

  for (const row of violationRows) {
    if (!row.package_version_id) continue;
    const list = violationsByEntity.get(row.package_version_id) ?? [];
    list.push(row);
    violationsByEntity.set(row.package_version_id, list);
  }

  return summaries.map((summary) => {
    const entityViolations = (
      violationsByEntity.get(summary.package_version_id) ?? []
    ).sort((left, right) => {
      if (left.status !== right.status) return left.status === "open" ? -1 : 1;
      return severityRank(right.severity) - severityRank(left.severity);
    });

    const highestSeverity = entityViolations.reduce((current, violation) => {
      if (violation.status !== "open") return current;
      return severityRank(violation.severity) > severityRank(current)
        ? violation.severity
        : current;
    }, "NONE");

    const evidence = evidenceByPackageVersion.get(summary.package_version_id) as
      | {
          osv: unknown;
          intelligence: unknown;
          contributor: unknown;
          projects?: { id: string; name: string }[];
        }
      | undefined;

    return {
      packageId: summary.package_id,
      packageVersionId: summary.package_version_id,
      ecosystem: summary.ecosystem,
      name: summary.name,
      version: summary.version,
      displayName: `${summary.ecosystem}:${summary.name}@${summary.version}`,
      latestEvaluatedAt:
        summary.latest_evaluated_at instanceof Date
          ? summary.latest_evaluated_at.toISOString()
          : new Date(summary.latest_evaluated_at).toISOString(),
      openCount: Number(summary.open_count ?? 0),
      resolvedCount: Number(summary.resolved_count ?? 0),
      suppressedCount: Number(summary.suppressed_count ?? 0),
      blockedOpenCount: Number(summary.blocked_open_count ?? 0),
      advisoryOpenCount: Number(summary.advisory_open_count ?? 0),
      highestSeverity,
      projects: evidence?.projects ?? [],
      violations: entityViolations.map((violation) => ({
        id: violation.id,
        projectId: violation.project_id,
        projectName: violation.project_name ?? null,
        ruleName: violation.rule_name,
        policyName: violation.policy_name,
        severity: violation.severity,
        message: violation.message,
        enforcementMode: violation.enforcement_mode,
        blocked: violation.blocked,
        status: violation.status,
        statusNote: violation.status_note ?? null,
        recommendedRemediation: violation.recommended_remediation ?? null,
        firstSeenAt: violation.first_seen_at.toISOString(),
        lastSeenAt: violation.last_seen_at.toISOString(),
        occurrenceCount: Number(violation.occurrence_count ?? 0),
      })),
      evidence: {
        osv: evidence?.osv ?? null,
        intelligence: evidence?.intelligence ?? null,
        contributor: evidence?.contributor ?? null,
      },
    };
  });
}

function summaryStatusFilter(status: EntityStatusFilter) {
  switch (status) {
    case "open":
      return sql`AND v.status = 'open'`;
    case "resolved":
      return sql`AND v.status = 'resolved'`;
    case "suppressed":
      return sql`AND v.status = 'suppressed'`;
    default:
      return sql``;
  }
}

function violationStatusFilter(status: EntityStatusFilter) {
  switch (status) {
    case "open":
      return eq(violations.status, "open");
    case "resolved":
      return eq(violations.status, "resolved");
    case "suppressed":
      return eq(violations.status, "suppressed");
    default:
      return undefined;
  }
}

async function attachOccurrenceCounts<T extends ViolationRow>(
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;

  const countRows = await db
    .select({
      violation_id: violation_occurrences.violation_id,
      count: sql<string>`count(*)`,
    })
    .from(violation_occurrences)
    .where(
      inArray(
        violation_occurrences.violation_id,
        rows.map((row) => row.id),
      ),
    )
    .groupBy(violation_occurrences.violation_id);

  const counts = new Map(
    countRows.map((row) => [row.violation_id, Number(row.count)]),
  );

  return rows.map((row) => ({
    ...row,
    occurrence_count: counts.get(row.id) ?? 0,
  }));
}

async function loadProjectSummariesByStatus(
  projectId: string,
  tenantId: string,
  status: EntityStatusFilter,
  limit: number,
  offset: number,
) {
  const statusFilter = summaryStatusFilter(status);
  const rows = await db.execute<EntitySummaryRow>(sql`
    SELECT
      pv.id AS package_version_id,
      p.id AS package_id,
      p.ecosystem,
      p.package AS name,
      pv.version,
      MAX(v.last_seen_at) AS latest_evaluated_at,
      COUNT(*) FILTER (WHERE v.status = 'open') AS open_count,
      COUNT(*) FILTER (WHERE v.status = 'resolved') AS resolved_count,
      COUNT(*) FILTER (WHERE v.status = 'suppressed') AS suppressed_count,
      COUNT(*) FILTER (WHERE v.status = 'open' AND v.blocked = true) AS blocked_open_count,
      COUNT(*) FILTER (WHERE v.status = 'open' AND v.blocked = false) AS advisory_open_count,
      COUNT(*) OVER () AS total_count
    FROM (
      SELECT DISTINCT package_version_id
      FROM violations
      WHERE project_id = ${projectId}
        AND tenant_id = ${tenantId}
        AND package_version_id IS NOT NULL
    ) entities
    JOIN violations v
      ON v.package_version_id = entities.package_version_id
     AND v.project_id = ${projectId}
     AND v.tenant_id = ${tenantId}
    JOIN package_versions pv ON pv.id = v.package_version_id
    JOIN packages p ON p.id = pv.package_id
    ${statusFilter}
    GROUP BY pv.id, p.id, p.ecosystem, p.package, pv.version
    ORDER BY
      COUNT(*) FILTER (WHERE v.status = 'open' AND v.blocked = true) DESC,
      MAX(v.last_seen_at) DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return { rows, total: rows[0] ? Number(rows[0].total_count ?? 0) : 0 };
}

async function loadTenantSummaries(
  tenantId: string,
  allowedProjectIds: string[] | null,
  status: EntityStatusFilter,
  limit: number,
  offset: number,
) {
  const projectFilter =
    allowedProjectIds === null
      ? sql``
      : allowedProjectIds.length > 0
        ? sql`AND project_id = ANY(ARRAY[${sql.join(
            allowedProjectIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}])`
        : sql`AND false`;

  const statusFilter = summaryStatusFilter(status);
  const rows = await db.execute<EntitySummaryRow>(sql`
    SELECT
      pv.id AS package_version_id,
      p.id AS package_id,
      p.ecosystem,
      p.package AS name,
      pv.version,
      MAX(v.last_seen_at) AS latest_evaluated_at,
      COUNT(*) FILTER (WHERE v.status = 'open') AS open_count,
      COUNT(*) FILTER (WHERE v.status = 'resolved') AS resolved_count,
      COUNT(*) FILTER (WHERE v.status = 'suppressed') AS suppressed_count,
      COUNT(*) FILTER (WHERE v.status = 'open' AND v.blocked = true) AS blocked_open_count,
      COUNT(*) FILTER (WHERE v.status = 'open' AND v.blocked = false) AS advisory_open_count,
      COUNT(*) OVER () AS total_count
    FROM (
      SELECT DISTINCT package_version_id
      FROM violations
      WHERE tenant_id = ${tenantId}
      AND package_version_id IS NOT NULL
      ${projectFilter}
    ) entities
    JOIN violations v
      ON v.package_version_id = entities.package_version_id
     AND v.tenant_id = ${tenantId}
    JOIN package_versions pv ON pv.id = v.package_version_id
    JOIN packages p ON p.id = pv.package_id
    ${statusFilter}
    ${projectFilter}
    GROUP BY pv.id, p.id, p.ecosystem, p.package, pv.version
    ORDER BY
      COUNT(*) FILTER (WHERE v.status = 'open' AND v.blocked = true) DESC,
      MAX(v.last_seen_at) DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return { rows, total: rows[0] ? Number(rows[0].total_count ?? 0) : 0 };
}

projectViolationEntityRouter.get(
  "/v1/projects/:project_id/violations/entities",
  zValidator("query", querySchema),
  async (c) => {
    const capabilityResult = requireTenantCapability(c, "violations.read_project", "Access denied");
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    const accessResult = await requireProjectAccess(c);
    if (!accessResult.ok) return accessResult.response;
    const access = accessResult.value;

    const { projectId } = access;
    const { tenantId } = getAuthContext(c);
    const { limit, offset, status = "open" } = c.req.valid("query");
    const includeContributor = canReadContributor(c);
    const { rows, total } = await loadProjectSummariesByStatus(
      projectId,
      tenantId,
      status,
      limit,
      offset,
    );
    const statusClause = violationStatusFilter(status);

    if (rows.length === 0) {
      return c.json({ entities: [], pagination: { limit, offset, total } });
    }

    const packageVersionIds = rows.map((row) => row.package_version_id);
    const [rawViolationRows, evidencePackages] = await Promise.all([
      db
        .select()
        .from(violations)
        .where(
          and(
            eq(violations.project_id, projectId),
            eq(violations.tenant_id, tenantId),
            inArray(violations.package_version_id, packageVersionIds),
            statusClause,
          ),
        )
        .orderBy(desc(violations.last_seen_at)),
      loadProjectPackageEvidence(projectId, tenantId, packageVersionIds),
    ]);
    const violationRows = await attachOccurrenceCounts(rawViolationRows);

    const cacheIds = evidencePackages
      .map((pkg) => pkg.osv_cache_id)
      .filter((value): value is string => Boolean(value));
    const { cacheFindings, entityContextRows } =
      await loadProjectPackageFindingContext(
        projectId,
        tenantId,
        cacheIds,
        packageVersionIds,
      );

    const cacheFindingsByCache = new Map<string, typeof cacheFindings>();
    for (const finding of cacheFindings) {
      const list = cacheFindingsByCache.get(finding.cacheId) ?? [];
      list.push(finding);
      cacheFindingsByCache.set(finding.cacheId, list);
    }

    const entityContextByEntity = new Map<
      string,
      (typeof entityContextRows)[number]
  >();
  for (const row of entityContextRows) {
      entityContextByEntity.set(row.package_version_id, row);
  }

    const evidenceByPackageVersion = new Map<string, unknown>();
    for (const pkg of evidencePackages) {
      const vulns = pkg.osv_cache_id
        ? (cacheFindingsByCache.get(pkg.osv_cache_id) ?? [])
        : [];
      const entityContext = entityContextByEntity.get(pkg.package_version_id);
      const packageDispositions = entityContext?.dispositions ?? [];
      const osvDispositions = packageDispositions.filter(
        (item) => (item.connectorKey ?? "osv") === "osv",
      );
      const intelligenceDispositions = packageDispositions.filter(
        (item) => item.connectorKey === "intelligence",
      );

      evidenceByPackageVersion.set(pkg.package_version_id, {
        osv: {
          hasFindings:
            pkg.osv_risk_tier !== null && pkg.osv_risk_tier !== "NONE",
          highestSeverity: pkg.osv_risk_tier ?? "NONE",
          vulnCount: Number(pkg.osv_finding_count ?? 0),
          fixAvailable: pkg.osv_remediation_available ?? false,
          bestFixVersion: pkg.osv_best_remediation ?? null,
          latestVersion: pkg.latest_version ?? null,
          latestVersionPublishedAt: pkg.latest_version_published_at
            ? new Date(pkg.latest_version_published_at).toISOString()
            : null,
          networkExploitable: vulns.some(
            (finding) => finding.attributes?.attack_vector === "NETWORK",
          ),
          findingStatus:
            osvDispositions.length === 0
              ? null
              : osvDispositions.some((item) => item.status === "open")
                ? "open"
                : osvDispositions.every(
                      (item) => item.status === "suppressed",
                    )
                  ? "suppressed"
                  : "resolved",
          findings: osvDispositions,
          vulns: vulns.map((finding) => ({
            findingId: finding.findingId,
            severity: finding.severity,
            title: finding.title ?? null,
            publishedAt: finding.publishedAt?.toISOString() ?? null,
            daysSincePublished: finding.publishedAt
              ? Math.floor(
                  (Date.now() - finding.publishedAt.getTime()) / 86_400_000,
                )
              : null,
            attributes: finding.attributes,
            disposition:
              osvDispositions.find(
                (item) => item.findingId === finding.findingId,
              ) ?? null,
          })),
        },
        intelligence:
          pkg.intelligence_cache_id !== null &&
          pkg.intelligence_cache_id !== undefined
            ? {
                hasFinding: intelligenceDispositions.length > 0,
                nearestMatch: pkg.intelligence_nearest_match ?? null,
                recommendedAction:
                  pkg.intelligence_recommended_action ?? "allow",
                confidence: pkg.intelligence_confidence ?? "low",
                matchQuality: pkg.intelligence_match_quality ?? "weak",
                candidateTrust: pkg.intelligence_candidate_trust ?? null,
                llmVerdict: pkg.intelligence_llm_verdict ?? null,
                semanticScore:
                  pkg.intelligence_semantic_score !== null &&
                  pkg.intelligence_semantic_score !== undefined
                    ? Number(pkg.intelligence_semantic_score)
                    : null,
                lexicalSimilarityScore:
                  pkg.intelligence_lexical_similarity_score !== null &&
                  pkg.intelligence_lexical_similarity_score !== undefined
                    ? Number(pkg.intelligence_lexical_similarity_score)
                    : null,
                findingStatus:
                  intelligenceDispositions.length === 0
                    ? null
                    : intelligenceDispositions.some(
                          (item) => item.status === "open",
                        )
                      ? "open"
                      : intelligenceDispositions.every(
                            (item) => item.status === "suppressed",
                          )
                        ? "suppressed"
                        : "resolved",
                findings: intelligenceDispositions,
              }
            : null,
        contributor: includeContributor
          ? {
              status: pkg.contributor_cache_id ? "ready" : "unavailable",
              hasFinding:
                pkg.contributor_cache_id !== null &&
                pkg.contributor_tier !== null &&
                pkg.contributor_tier !== "NONE",
              tier: pkg.contributor_cache_id
                ? (pkg.contributor_tier ?? "NONE")
                : null,
              score:
                pkg.contributor_cache_id !== null
                  ? Number(pkg.contributor_score ?? 0)
                  : null,
              publisher: pkg.publisher ?? null,
              publisherSeenBeforePackage:
                pkg.publisher_seen_before_package ?? null,
              publisherSeenCountBefore:
                pkg.publisher_seen_count_before !== null
                  ? Number(pkg.publisher_seen_count_before)
                  : null,
              publisherMatchesPriorVersion:
                pkg.publisher_matches_prior_version ?? null,
              maintainerSetChanged: pkg.maintainer_set_changed ?? null,
              newMaintainerCount:
                pkg.new_maintainer_count !== null
                  ? Number(pkg.new_maintainer_count)
                  : null,
              removedMaintainerCount:
                pkg.removed_maintainer_count !== null
                  ? Number(pkg.removed_maintainer_count)
                  : null,
              maintainerCount:
                pkg.maintainer_count !== null
                  ? Number(pkg.maintainer_count)
                  : null,
              hasInstallScripts: pkg.has_install_scripts ?? null,
              hasProvenance: pkg.has_provenance ?? null,
              hasTrustedPublisher: pkg.has_trusted_publisher ?? null,
              releaseVelocity7d:
                pkg.release_velocity_7d !== null
                  ? Number(pkg.release_velocity_7d)
                  : null,
              releaseVelocity30d:
                pkg.release_velocity_30d !== null
                  ? Number(pkg.release_velocity_30d)
                  : null,
              historyComplete: pkg.history_complete ?? null,
              rawFactors: pkg.contributor_raw_factors ?? null,
              lastScoredAt: pkg.contributor_last_scored_at
                ? new Date(pkg.contributor_last_scored_at).toISOString()
                : null,
            }
          : null,
      });
    }

    return c.json({
      entities: buildResponse(rows, violationRows, evidenceByPackageVersion),
      pagination: { limit, offset, total },
    });
  },
);

tenantViolationEntityRouter.get(
  "/v1/tenants/:tenant_id/violations/entities",
  zValidator("query", querySchema),
  async (c) => {
    const tenantIdResult = requireTenantCapabilityAccess(
      c,
      "violations.read_tenant",
      "Access denied",
    );
    if (!tenantIdResult.ok) return tenantIdResult.response;
    const tenantId = tenantIdResult.value;

    const { limit, offset, status = "open" } = c.req.valid("query");
    const includeContributor = canReadContributor(c);
    const allowedProjectIds = await listAccessibleProjectIds(c);
    const { rows, total } = await loadTenantSummaries(
      tenantId,
      allowedProjectIds,
      status,
      limit,
      offset,
    );
    const statusClause = violationStatusFilter(status);

    if (rows.length === 0) {
      return c.json({ entities: [], pagination: { limit, offset, total } });
    }

    const packageVersionIds = rows.map((row) => row.package_version_id);
    const projectScope =
      allowedProjectIds === null
        ? undefined
        : allowedProjectIds.length > 0
          ? inArray(violations.project_id, allowedProjectIds)
          : sql`false`;

    const [rawViolationRows, evidencePackages] = await Promise.all([
      db
        .select({
          id: violations.id,
          tenant_id: violations.tenant_id,
          project_id: violations.project_id,
          rule_id: violations.rule_id,
          policy_id: violations.policy_id,
          rule_name: rules.name,
          policy_name: policies.name,
          recommended_remediation: violations.recommended_remediation,
          entity_type: violations.entity_type,
          package_id: violations.package_id,
          package_version_id: violations.package_version_id,
          severity: violations.severity,
          code: violations.code,
          message: violations.message,
          enforcement_mode: violations.enforcement_mode,
          blocked: violations.blocked,
          status: violations.status,
          status_note: violations.status_note,
          first_seen_at: violations.first_seen_at,
          last_seen_at: violations.last_seen_at,
          created_at: violations.created_at,
          project_name: projects.name,
        })
        .from(violations)
        .innerJoin(projects, eq(violations.project_id, projects.id))
        .leftJoin(rules, eq(violations.rule_id, rules.id))
        .leftJoin(policies, eq(violations.policy_id, policies.id))
        .where(
          and(
            eq(violations.tenant_id, tenantId),
            inArray(violations.package_version_id, packageVersionIds),
            projectScope,
            statusClause,
          ),
        )
        .orderBy(desc(violations.last_seen_at)),
      loadTenantPackageEvidence(tenantId, packageVersionIds),
    ]);
    const violationRows = await attachOccurrenceCounts(rawViolationRows);

    const cacheIds = evidencePackages
      .map((pkg) => pkg.osv_cache_id)
      .filter((value): value is string => Boolean(value));
    const packageIds = evidencePackages
      .map((pkg) => pkg.package_id)
      .filter((value): value is string => Boolean(value));
    const { cacheFindings } = await loadTenantPackageContext(
      tenantId,
      cacheIds,
      packageIds,
      packageVersionIds,
    );

    const cacheFindingsByCache = new Map<string, typeof cacheFindings>();
    for (const finding of cacheFindings) {
      const list = cacheFindingsByCache.get(finding.cacheId) ?? [];
      list.push(finding);
      cacheFindingsByCache.set(finding.cacheId, list);
    }

    const projectsByPackageVersion = new Map<
      string,
      { id: string; name: string }[]
    >();
    for (const row of violationRows) {
      if (!row.package_version_id) continue;
      const list = projectsByPackageVersion.get(row.package_version_id) ?? [];
      if (!list.some((project) => project.id === row.project_id)) {
        list.push({ id: row.project_id, name: row.project_name ?? "Project" });
      }
      projectsByPackageVersion.set(row.package_version_id, list);
    }

    const evidenceByPackageVersion = new Map<string, unknown>();
    for (const pkg of evidencePackages) {
      const vulns = pkg.osv_cache_id
        ? (cacheFindingsByCache.get(pkg.osv_cache_id) ?? [])
        : [];
      evidenceByPackageVersion.set(pkg.package_version_id, {
        projects: projectsByPackageVersion.get(pkg.package_version_id) ?? [],
        osv: {
          hasFindings:
            pkg.osv_risk_tier !== null && pkg.osv_risk_tier !== "NONE",
          highestSeverity: pkg.osv_risk_tier ?? "NONE",
          vulnCount: Number(pkg.osv_finding_count ?? 0),
          fixAvailable: pkg.osv_remediation_available ?? false,
          bestFixVersion: pkg.osv_best_remediation ?? null,
          latestVersion: pkg.latest_version ?? null,
          latestVersionPublishedAt: pkg.latest_version_published_at
            ? new Date(pkg.latest_version_published_at).toISOString()
            : null,
          networkExploitable: vulns.some(
            (finding) => finding.attributes?.attack_vector === "NETWORK",
          ),
          findingStatus: null,
          findings: [],
          vulns: vulns.map((finding) => ({
            findingId: finding.findingId,
            severity: finding.severity,
            title: finding.title ?? null,
            publishedAt: finding.publishedAt?.toISOString() ?? null,
            daysSincePublished: finding.publishedAt
              ? Math.floor(
                  (Date.now() - finding.publishedAt.getTime()) / 86_400_000,
                )
              : null,
            attributes: finding.attributes,
            disposition: null,
          })),
        },
        intelligence:
          pkg.intelligence_cache_id !== null &&
          pkg.intelligence_cache_id !== undefined
            ? {
                hasFinding: false,
                nearestMatch: pkg.intelligence_nearest_match ?? null,
                recommendedAction:
                  pkg.intelligence_recommended_action ?? "allow",
                confidence: pkg.intelligence_confidence ?? "low",
                matchQuality: pkg.intelligence_match_quality ?? "weak",
                candidateTrust: pkg.intelligence_candidate_trust ?? null,
                llmVerdict: pkg.intelligence_llm_verdict ?? null,
                semanticScore:
                  pkg.intelligence_semantic_score !== null &&
                  pkg.intelligence_semantic_score !== undefined
                    ? Number(pkg.intelligence_semantic_score)
                    : null,
                lexicalSimilarityScore:
                  pkg.intelligence_lexical_similarity_score !== null &&
                  pkg.intelligence_lexical_similarity_score !== undefined
                    ? Number(pkg.intelligence_lexical_similarity_score)
                    : null,
                findingStatus: null,
                findings: [],
              }
            : null,
        contributor: includeContributor
          ? {
              status: pkg.contributor_cache_id ? "ready" : "unavailable",
              hasFinding:
                pkg.contributor_cache_id !== null &&
                pkg.contributor_tier !== null &&
                pkg.contributor_tier !== "NONE",
              tier: pkg.contributor_cache_id
                ? (pkg.contributor_tier ?? "NONE")
                : null,
              score:
                pkg.contributor_cache_id !== null
                  ? Number(pkg.contributor_score ?? 0)
                  : null,
              publisher: pkg.publisher ?? null,
              publisherSeenBeforePackage:
                pkg.publisher_seen_before_package ?? null,
              publisherSeenCountBefore:
                pkg.publisher_seen_count_before !== null
                  ? Number(pkg.publisher_seen_count_before)
                  : null,
              publisherMatchesPriorVersion:
                pkg.publisher_matches_prior_version ?? null,
              maintainerSetChanged: pkg.maintainer_set_changed ?? null,
              newMaintainerCount:
                pkg.new_maintainer_count !== null
                  ? Number(pkg.new_maintainer_count)
                  : null,
              removedMaintainerCount:
                pkg.removed_maintainer_count !== null
                  ? Number(pkg.removed_maintainer_count)
                  : null,
              maintainerCount:
                pkg.maintainer_count !== null
                  ? Number(pkg.maintainer_count)
                  : null,
              hasInstallScripts: pkg.has_install_scripts ?? null,
              hasProvenance: pkg.has_provenance ?? null,
              hasTrustedPublisher: pkg.has_trusted_publisher ?? null,
              releaseVelocity7d:
                pkg.release_velocity_7d !== null
                  ? Number(pkg.release_velocity_7d)
                  : null,
              releaseVelocity30d:
                pkg.release_velocity_30d !== null
                  ? Number(pkg.release_velocity_30d)
                  : null,
              historyComplete: pkg.history_complete ?? null,
              rawFactors: pkg.contributor_raw_factors ?? null,
              lastScoredAt: pkg.contributor_last_scored_at
                ? new Date(pkg.contributor_last_scored_at).toISOString()
                : null,
            }
          : null,
      });
    }

    return c.json({
      entities: buildResponse(rows, violationRows, evidenceByPackageVersion),
      pagination: { limit, offset, total },
    });
  },
);
