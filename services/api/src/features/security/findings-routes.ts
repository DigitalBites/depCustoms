import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { VALID_TO_INFINITY_ISO } from "@customs/shared-constants";
import { db } from "../../db/index.js";
import {
  findings as findings_table,
  finding_versions,
  project_findings,
  violations,
} from "../../db/schema.js";
import {
  getAuthContext,
  requireProjectAccess,
  requireTenantCapability,
} from "../../http/guards.js";
import { findingsQuerySchema } from "./shared.js";

export const projectSecurityFindingsRouter = new Hono();

projectSecurityFindingsRouter.get(
  "/v1/projects/:project_id/findings",
  zValidator("query", findingsQuerySchema),
  async (c) => {
    const capabilityResult = requireTenantCapability(c, "security.read_project", "Access denied");
  if (!capabilityResult.ok) {
    return capabilityResult.response;
  }

    const accessResult = await requireProjectAccess(c);
    if (!accessResult.ok) return accessResult.response;
    const access = accessResult.value;

    const { projectId } = access;
    const { tenantId } = getAuthContext(c);
    const {
      connector_key: connectorKey,
      severity,
      limit,
      offset,
    } = c.req.valid("query");
    const now = new Date();

    const conditions = [
      eq(project_findings.project_id, projectId),
      eq(project_findings.tenant_id, tenantId),
      lte(project_findings.observed_from, now),
      gt(project_findings.observed_to, now),
      ...(connectorKey ? [eq(findings_table.connector_key, connectorKey)] : []),
      ...(severity ? [eq(finding_versions.severity, severity)] : []),
    ];

    const [rows, [countRow]] = await Promise.all([
      db
        .select({
          id: project_findings.id,
          tenant_id: project_findings.tenant_id,
          project_id: project_findings.project_id,
          package_id: project_findings.package_id,
          package_version_id: project_findings.package_version_id,
          finding_key: project_findings.finding_key,
          current_finding_version_id:
            project_findings.current_finding_version_id,
          observed_from: project_findings.observed_from,
          observed_to: project_findings.observed_to,
          last_seen_at: project_findings.last_seen_at,
          created_at: project_findings.created_at,
          connector_key: findings_table.connector_key,
          finding_id: findings_table.external_finding_id,
          severity: finding_versions.severity,
          title: finding_versions.title,
        })
        .from(project_findings)
        .innerJoin(
          findings_table,
          eq(project_findings.finding_key, findings_table.finding_key),
        )
        .innerJoin(
          finding_versions,
          eq(
            project_findings.current_finding_version_id,
            finding_versions.id,
          ),
        )
        .where(and(...conditions))
        .orderBy(
          sql`CASE ${finding_versions.severity} WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END`,
          desc(project_findings.last_seen_at),
        )
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<string>`count(*)` })
        .from(project_findings)
        .innerJoin(
          findings_table,
          eq(project_findings.finding_key, findings_table.finding_key),
        )
        .innerJoin(
          finding_versions,
          eq(
            project_findings.current_finding_version_id,
            finding_versions.id,
          ),
        )
        .where(and(...conditions)),
    ]);

    let violationCountMap = new Map<string, number>();
    if (rows.length > 0) {
      const packageVersionIds = [
        ...new Set(
          rows
            .map((row) => row.package_version_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const countRows =
        packageVersionIds.length > 0
          ? await db
              .select({
                package_version_id: violations.package_version_id,
                count: sql<string>`count(*)`,
              })
              .from(violations)
              .where(
                and(
                  eq(violations.project_id, projectId),
                  inArray(violations.package_version_id, packageVersionIds),
                  eq(violations.status, "open"),
                ),
              )
              .groupBy(violations.package_version_id)
          : [];

      violationCountMap = new Map(
        countRows
          .filter((row) => row.package_version_id)
          .map((row) => [row.package_version_id!, Number(row.count)]),
      );
    }

    const findings = rows.map((row) => ({
      ...row,
      observation_status:
        row.observed_to?.toISOString?.() === VALID_TO_INFINITY_ISO
          ? "observed"
          : "closed",
      open_violation_count:
        (row.package_version_id
          ? violationCountMap.get(row.package_version_id)
          : undefined) ?? 0,
    }));

    return c.json({
      findings,
      pagination: { total: Number(countRow?.count ?? 0), offset, limit },
    });
  },
);
