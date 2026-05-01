import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../../db/index.js";
import {
  connector_cache,
  contributor_release_facts,
  packages,
  package_versions,
  project_findings,
  project_package_usage,
  violations,
} from "../../../db/schema.js";
import {
  loadEffectivePolicy,
  loadSnapshots,
} from "../../../policy/effective.js";
import {
  evaluateConditionWithTrace,
  renderTemplate,
} from "../../../policy/expression.js";
import {
  resolveFields,
  unavailableSnapshot,
} from "../../../policy/resolver.js";
import { extractConnectorKeys } from "../../policy-preview/shared.js";

const latestPackageVersions = alias(
  package_versions,
  "mcp_latest_package_versions",
);
const osvConnectorCache = alias(connector_cache, "mcp_osv_connector_cache");
const contributorConnectorCache = alias(
  connector_cache,
  "mcp_contributor_connector_cache",
);

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  NONE: 0,
};

export function severityRank(severity: string | null): number {
  return severity ? (SEVERITY_ORDER[severity] ?? 0) : 0;
}

export function toIsoString(
  value: Date | string | null | undefined,
): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

export type PackageVersionContext = {
  ecosystem: string;
  package: string;
  version: string;
  package_id: string | null;
  used_version_published_at: string | null;
  latest_version: string | null;
  latest_version_published_at: string | null;
  is_latest: boolean | null;
  latest_package_version_id: string | null;
  fix_available: boolean;
  fix_version: string | null;
  vuln_count: number;
  max_severity: string | null;
  recently_observed: boolean;
  request_count: number;
  allow_count: number;
  block_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  open_findings_count: number;
  finding_summary: string | null;
  historical_blocks_count: number;
  last_blocked_at: string | null;
  last_block_reason_code: string | null;
  last_block_reason_summary: string | null;
  last_block_matched_rule: string | null;
  last_block_enforcement_mode: string | null;
  contributor_context?: {
    risk_score: number;
    score_tier: string | null;
    publisher: string | null;
    publisher_seen_before_package: boolean | null;
    publisher_seen_count_before: number | null;
    publisher_matches_prior_version: boolean | null;
    maintainer_set_changed: boolean | null;
    new_maintainer_count: number | null;
    removed_maintainer_count: number | null;
    maintainer_count: number | null;
    has_install_scripts: boolean | null;
    has_provenance: boolean | null;
    has_trusted_publisher: boolean | null;
    release_velocity_7d: number | null;
    release_velocity_30d: number | null;
    history_complete: boolean | null;
    raw_factors: Record<string, number | null> | null;
    last_scored_at: string | null;
  } | null;
};

export type PolicyPreviewSummary = {
  decision: "allow" | "block";
  reason_code: string;
  reason_summary: string;
  matched_rule: string | null;
  enforcement_mode: string | null;
  blocked_by_rule_id: string | null;
  policies_evaluated: number;
  rules_evaluated: number;
  rules_matched: number;
  snapshot_statuses: Record<string, string>;
  used_snapshot_count: number;
};

type ContributorContextRow = {
  contributor_risk_score?: number | null;
  contributor_score_tier?: string | null;
  contributor_publisher?: string | null;
  contributor_publisher_seen_before_package?: boolean | null;
  contributor_publisher_seen_count_before?: number | null;
  contributor_publisher_matches_prior_version?: boolean | null;
  contributor_maintainer_set_changed?: boolean | null;
  contributor_new_maintainer_count?: number | null;
  contributor_removed_maintainer_count?: number | null;
  contributor_maintainer_count?: number | null;
  contributor_has_install_scripts?: boolean | null;
  contributor_has_provenance?: boolean | null;
  contributor_has_trusted_publisher?: boolean | null;
  contributor_release_velocity_7d?: number | null;
  contributor_release_velocity_30d?: number | null;
  contributor_history_complete?: boolean | null;
  contributor_raw_factors?: Record<string, number | null> | null;
  contributor_last_scored_at?: Date | string | null;
};

function buildContributorContext(
  row: ContributorContextRow | null | undefined,
): PackageVersionContext["contributor_context"] {
  if (!row) return null;

  const riskScore = row.contributor_risk_score ?? 0;
  const hasSignals =
    row.contributor_score_tier !== null &&
    row.contributor_score_tier !== undefined;

  if (!hasSignals && riskScore === 0 && !row.contributor_last_scored_at) {
    return null;
  }

  return {
    risk_score: riskScore,
    score_tier: row.contributor_score_tier ?? null,
    publisher: row.contributor_publisher ?? null,
    publisher_seen_before_package:
      row.contributor_publisher_seen_before_package ?? null,
    publisher_seen_count_before:
      row.contributor_publisher_seen_count_before ?? null,
    publisher_matches_prior_version:
      row.contributor_publisher_matches_prior_version ?? null,
    maintainer_set_changed: row.contributor_maintainer_set_changed ?? null,
    new_maintainer_count: row.contributor_new_maintainer_count ?? null,
    removed_maintainer_count: row.contributor_removed_maintainer_count ?? null,
    maintainer_count: row.contributor_maintainer_count ?? null,
    has_install_scripts: row.contributor_has_install_scripts ?? null,
    has_provenance: row.contributor_has_provenance ?? null,
    has_trusted_publisher: row.contributor_has_trusted_publisher ?? null,
    release_velocity_7d: row.contributor_release_velocity_7d ?? null,
    release_velocity_30d: row.contributor_release_velocity_30d ?? null,
    history_complete: row.contributor_history_complete ?? null,
    raw_factors: row.contributor_raw_factors ?? null,
    last_scored_at: toIsoString(row.contributor_last_scored_at),
  };
}

export async function loadPackageVersionContext(
  projectId: string,
  tenantId: string,
  ecosystem: string,
  packageName: string,
  version: string,
): Promise<PackageVersionContext> {
  const entityId = `${ecosystem}:${packageName}:${version}`;

  const [
    [packageRow],
    [latestPackageRow],
    findingRows,
    [usageRow],
    [latestBlockedRow],
    [blockedCountRow],
  ] = await Promise.all([
    db
      .select({
        package_id: packages.id,
        used_version_published_at: package_versions.published_at,
        is_latest: sql<
          boolean | null
        >`${packages.latest_package_version_id} = ${package_versions.id}`,
        latest_package_version_id: packages.latest_package_version_id,
        latest_version: latestPackageVersions.version,
        latest_version_published_at: latestPackageVersions.published_at,
        fix_available: osvConnectorCache.fix_available,
        fix_version: osvConnectorCache.best_fix_version,
        vuln_count: osvConnectorCache.vuln_count,
        max_severity: osvConnectorCache.max_severity,
        contributor_risk_score: contributorConnectorCache.vuln_count,
        contributor_score_tier: contributorConnectorCache.max_severity,
        contributor_publisher: sql<
          string | null
        >`${contributor_release_facts.publish_actor}`,
        contributor_publisher_seen_before_package:
          contributor_release_facts.publisher_seen_before_package,
        contributor_publisher_seen_count_before:
          contributor_release_facts.publisher_seen_count_before,
        contributor_publisher_matches_prior_version:
          contributor_release_facts.publisher_matches_prior_version,
        contributor_maintainer_set_changed:
          contributor_release_facts.maintainer_set_changed,
        contributor_new_maintainer_count:
          contributor_release_facts.new_maintainer_count,
        contributor_removed_maintainer_count:
          contributor_release_facts.removed_maintainer_count,
        contributor_maintainer_count:
          contributor_release_facts.maintainer_count,
        contributor_has_install_scripts:
          contributor_release_facts.has_install_scripts,
        contributor_has_provenance: contributor_release_facts.has_provenance,
        contributor_has_trusted_publisher:
          contributor_release_facts.has_trusted_publisher,
        contributor_release_velocity_7d:
          contributor_release_facts.release_velocity_7d_at_publish,
        contributor_release_velocity_30d:
          contributor_release_facts.release_velocity_30d_at_publish,
        contributor_history_complete:
          contributor_release_facts.history_complete,
        contributor_raw_factors: sql<Record<
          string,
          number | null
        > | null>`${contributorConnectorCache.data}->'findings'->0->'attributes'->'raw_factors'`,
        contributor_last_scored_at: contributorConnectorCache.queried_at,
      })
      .from(package_versions)
      .innerJoin(packages, eq(package_versions.package_id, packages.id))
      .leftJoin(
        latestPackageVersions,
        eq(packages.latest_package_version_id, latestPackageVersions.id),
      )
      .leftJoin(
        osvConnectorCache,
        and(
          eq(osvConnectorCache.connector_id, "osv"),
          eq(osvConnectorCache.ecosystem, packages.ecosystem),
          eq(osvConnectorCache.package, packages.package),
          eq(osvConnectorCache.version, package_versions.version),
        ),
      )
      .leftJoin(
        contributorConnectorCache,
        and(
          eq(contributorConnectorCache.connector_id, "contributor"),
          eq(contributorConnectorCache.ecosystem, packages.ecosystem),
          eq(contributorConnectorCache.package, packages.package),
          eq(contributorConnectorCache.version, package_versions.version),
        ),
      )
      .leftJoin(
        contributor_release_facts,
        eq(contributor_release_facts.package_version_id, package_versions.id),
      )
      .where(
        and(
          eq(packages.ecosystem, ecosystem),
          eq(packages.package, packageName),
          eq(package_versions.version, version),
        ),
      )
      .limit(1),
    db
      .select({
        latest_version: package_versions.version,
        latest_version_published_at: package_versions.published_at,
      })
      .from(packages)
      .innerJoin(
        package_versions,
        eq(packages.latest_package_version_id, package_versions.id),
      )
      .where(
        and(
          eq(packages.ecosystem, ecosystem),
          eq(packages.package, packageName),
        ),
      )
      .limit(1),
    db
      .select({
        severity: project_findings.severity,
        status: project_findings.status,
        title: project_findings.title,
      })
      .from(project_findings)
      .where(
        and(
          eq(project_findings.project_id, projectId),
          eq(project_findings.tenant_id, tenantId),
          eq(project_findings.entity_id, entityId),
        ),
      ),
    db
      .select({
        first_seen_at: project_package_usage.created_at,
        last_seen_at: project_package_usage.updated_at,
        request_count: project_package_usage.request_count,
        allow_count: project_package_usage.allow_count,
        block_count: project_package_usage.block_count,
      })
      .from(project_package_usage)
      .innerJoin(
        package_versions,
        eq(project_package_usage.package_version_id, package_versions.id),
      )
      .innerJoin(packages, eq(package_versions.package_id, packages.id))
      .where(
        and(
          eq(project_package_usage.project_id, projectId),
          eq(project_package_usage.tenant_id, tenantId),
          eq(packages.ecosystem, ecosystem),
          eq(packages.package, packageName),
          eq(package_versions.version, version),
        ),
      )
      .limit(1),
    db
      .select({
        blocked_at: violations.last_seen_at,
        reason_code: violations.code,
        reason_summary: violations.message,
        matched_rule: violations.rule_name,
        enforcement_mode: violations.enforcement_mode,
      })
      .from(violations)
      .where(
        and(
          eq(violations.project_id, projectId),
          eq(violations.tenant_id, tenantId),
          eq(violations.entity_id, entityId),
          eq(violations.blocked, true),
        ),
      )
      .orderBy(desc(violations.last_seen_at))
      .limit(1),
    db
      .select({
        count: sql<string>`count(*)`,
      })
      .from(violations)
      .where(
        and(
          eq(violations.project_id, projectId),
          eq(violations.tenant_id, tenantId),
          eq(violations.entity_id, entityId),
          eq(violations.blocked, true),
        ),
      ),
  ]);

  const openFindings = findingRows.filter((row) => row.status === "open");
  const maxSeverity = openFindings.reduce<string | null>((current, row) => {
    if (!current || severityRank(row.severity) > severityRank(current)) {
      return row.severity;
    }
    return current;
  }, packageRow?.max_severity ?? null);

  return {
    ecosystem,
    package: packageName,
    version,
    package_id: packageRow?.package_id ?? null,
    used_version_published_at: toIsoString(
      packageRow?.used_version_published_at,
    ),
    latest_version:
      packageRow?.latest_version ?? latestPackageRow?.latest_version ?? null,
    latest_version_published_at:
      toIsoString(packageRow?.latest_version_published_at) ??
      toIsoString(latestPackageRow?.latest_version_published_at) ??
      null,
    is_latest: packageRow?.is_latest ?? null,
    latest_package_version_id: packageRow?.latest_package_version_id ?? null,
    fix_available: packageRow?.fix_available ?? false,
    fix_version: packageRow?.fix_version ?? null,
    vuln_count: packageRow?.vuln_count ?? 0,
    max_severity: maxSeverity,
    recently_observed: Boolean(usageRow),
    request_count: usageRow?.request_count ?? 0,
    allow_count: usageRow?.allow_count ?? 0,
    block_count: usageRow?.block_count ?? 0,
    first_seen_at: toIsoString(usageRow?.first_seen_at),
    last_seen_at: toIsoString(usageRow?.last_seen_at),
    open_findings_count: openFindings.length,
    finding_summary: openFindings[0]?.title ?? null,
    historical_blocks_count: Number(blockedCountRow?.count ?? 0),
    last_blocked_at: toIsoString(latestBlockedRow?.blocked_at),
    last_block_reason_code: latestBlockedRow?.reason_code ?? null,
    last_block_reason_summary: latestBlockedRow?.reason_summary ?? null,
    last_block_matched_rule: latestBlockedRow?.matched_rule ?? null,
    last_block_enforcement_mode: latestBlockedRow?.enforcement_mode ?? null,
    contributor_context: buildContributorContext(packageRow),
  };
}

export async function listObservedProjectPackageVersions(
  projectId: string,
  tenantId: string,
  ecosystem: string,
  packageName: string,
) {
  return db
    .select({
      version: package_versions.version,
      used_version_published_at: package_versions.published_at,
      is_latest: sql<
        boolean | null
      >`${packages.latest_package_version_id} = ${package_versions.id}`,
      latest_package_version_id: packages.latest_package_version_id,
      latest_version: latestPackageVersions.version,
      latest_version_published_at: latestPackageVersions.published_at,
      fix_version: osvConnectorCache.best_fix_version,
      fix_available: osvConnectorCache.fix_available,
      max_severity: osvConnectorCache.max_severity,
      vuln_count: osvConnectorCache.vuln_count,
      request_count: project_package_usage.request_count,
      allow_count: project_package_usage.allow_count,
      block_count: project_package_usage.block_count,
      first_seen_at: project_package_usage.created_at,
      last_seen_at: project_package_usage.updated_at,
      contributor_risk_score: contributorConnectorCache.vuln_count,
      contributor_score_tier: contributorConnectorCache.max_severity,
      contributor_publisher: sql<
        string | null
      >`${contributor_release_facts.publish_actor}`,
      contributor_publisher_seen_before_package:
        contributor_release_facts.publisher_seen_before_package,
      contributor_publisher_seen_count_before:
        contributor_release_facts.publisher_seen_count_before,
      contributor_publisher_matches_prior_version:
        contributor_release_facts.publisher_matches_prior_version,
      contributor_maintainer_set_changed:
        contributor_release_facts.maintainer_set_changed,
      contributor_new_maintainer_count:
        contributor_release_facts.new_maintainer_count,
      contributor_removed_maintainer_count:
        contributor_release_facts.removed_maintainer_count,
      contributor_maintainer_count: contributor_release_facts.maintainer_count,
      contributor_has_install_scripts:
        contributor_release_facts.has_install_scripts,
      contributor_has_provenance: contributor_release_facts.has_provenance,
      contributor_has_trusted_publisher:
        contributor_release_facts.has_trusted_publisher,
      contributor_release_velocity_7d:
        contributor_release_facts.release_velocity_7d_at_publish,
      contributor_release_velocity_30d:
        contributor_release_facts.release_velocity_30d_at_publish,
      contributor_history_complete: contributor_release_facts.history_complete,
      contributor_raw_factors: sql<Record<
        string,
        number | null
      > | null>`${contributorConnectorCache.data}->'findings'->0->'attributes'->'raw_factors'`,
      contributor_last_scored_at: contributorConnectorCache.queried_at,
    })
    .from(project_package_usage)
    .innerJoin(
      package_versions,
      eq(project_package_usage.package_version_id, package_versions.id),
    )
    .innerJoin(packages, eq(package_versions.package_id, packages.id))
    .leftJoin(
      latestPackageVersions,
      eq(packages.latest_package_version_id, latestPackageVersions.id),
    )
    .leftJoin(
      osvConnectorCache,
      and(
        eq(osvConnectorCache.connector_id, "osv"),
        eq(osvConnectorCache.ecosystem, packages.ecosystem),
        eq(osvConnectorCache.package, packages.package),
        eq(osvConnectorCache.version, package_versions.version),
      ),
    )
    .leftJoin(
      contributorConnectorCache,
      and(
        eq(contributorConnectorCache.connector_id, "contributor"),
        eq(contributorConnectorCache.ecosystem, packages.ecosystem),
        eq(contributorConnectorCache.package, packages.package),
        eq(contributorConnectorCache.version, package_versions.version),
      ),
    )
    .leftJoin(
      contributor_release_facts,
      eq(contributor_release_facts.package_version_id, package_versions.id),
    )
    .where(
      and(
        eq(project_package_usage.project_id, projectId),
        eq(project_package_usage.tenant_id, tenantId),
        eq(packages.ecosystem, ecosystem),
        eq(packages.package, packageName),
      ),
    )
    .orderBy(desc(project_package_usage.updated_at));
}

export async function loadLatestKnownPackageVersion(
  ecosystem: string,
  packageName: string,
) {
  const [row] = await db
    .select({
      version: package_versions.version,
      published_at: package_versions.published_at,
    })
    .from(packages)
    .innerJoin(
      package_versions,
      eq(packages.latest_package_version_id, package_versions.id),
    )
    .where(
      and(eq(packages.ecosystem, ecosystem), eq(packages.package, packageName)),
    )
    .limit(1);

  return row ?? null;
}

export async function previewPackageDecision(
  projectId: string,
  tenantId: string,
  ecosystem: string,
  packageName: string,
  version: string,
): Promise<PolicyPreviewSummary> {
  const policySnapshot = await loadEffectivePolicy(db, tenantId, projectId);
  if (policySnapshot.allRules.length === 0) {
    return {
      decision: "allow",
      reason_code: "no_rules",
      reason_summary: "No active rules configured",
      matched_rule: null,
      enforcement_mode: null,
      blocked_by_rule_id: null,
      policies_evaluated: 0,
      rules_evaluated: 0,
      rules_matched: 0,
      snapshot_statuses: {},
      used_snapshot_count: 0,
    };
  }

  const entityId = `${ecosystem}:${packageName}:${version}`;
  const storedSnapshots = await loadSnapshots(
    db,
    projectId,
    entityId,
    "artifact",
  );
  const connectorKeys = new Set<string>();
  for (const rule of policySnapshot.allRules) {
    extractConnectorKeys(rule.condition, connectorKeys);
  }

  const allSnapshots = [...storedSnapshots];
  for (const key of connectorKeys) {
    if (!storedSnapshots.some((snapshot) => snapshot.connectorKey === key)) {
      allSnapshots.push(unavailableSnapshot(key));
    }
  }

  const fields = resolveFields(allSnapshots, {
    ecosystem,
    pkg: packageName,
    version,
  });

  let decision: "allow" | "block" = "allow";
  let reasonCode = "allowed";
  let reasonSummary = "No policy rules matched";
  let matchedRule: string | null = null;
  let enforcementMode: string | null = null;
  let blockedByRuleId: string | null = null;
  let rulesMatched = 0;

  for (const rule of policySnapshot.allRules) {
    const { result } = evaluateConditionWithTrace(rule.condition, fields);
    if (!result) continue;

    rulesMatched++;

    const action = rule.action;
    const message = action.message_template
      ? renderTemplate(action.message_template, fields)
      : `Rule "${rule.name}" matched`;

    if (
      action.type === "violation" &&
      rule.effectiveEnforcementMode === "enforcing" &&
      decision === "allow"
    ) {
      decision = "block";
      reasonCode = action.code ?? "policy_violation";
      reasonSummary = message;
      matchedRule = rule.name;
      enforcementMode = rule.effectiveEnforcementMode;
      blockedByRuleId = rule.id;
    } else if (decision === "allow" && matchedRule === null) {
      reasonCode =
        action.type === "violation"
          ? "advisory_only"
          : (action.code ?? "matched");
      reasonSummary = message;
      matchedRule = rule.name;
      enforcementMode = rule.effectiveEnforcementMode;
    }
  }

  if (decision === "allow" && rulesMatched === 0) {
    reasonCode = "allowed";
    reasonSummary = "No policy rules matched";
  }

  return {
    decision,
    reason_code: reasonCode,
    reason_summary: reasonSummary,
    matched_rule: matchedRule,
    enforcement_mode: enforcementMode,
    blocked_by_rule_id: blockedByRuleId,
    policies_evaluated: policySnapshot.policies.length,
    rules_evaluated: policySnapshot.allRules.length,
    rules_matched: rulesMatched,
    snapshot_statuses: Object.fromEntries(
      allSnapshots.map((snapshot) => [
        snapshot.connectorKey,
        snapshot.meta.status,
      ]),
    ),
    used_snapshot_count: storedSnapshots.length,
  };
}
