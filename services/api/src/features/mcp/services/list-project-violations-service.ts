import { enrichViolations } from "../../violations/enrichment.js";
import { loadViolationFindings } from "../../violations/finding-details.js";
import { listProjectViolations } from "../../violations/project-shared.js";
import type { McpRequestContext } from "../context.js";
import { requireMcpProjectAccess } from "./project-access.js";

type ViolationFilters = {
  status?: string;
  severity?: string;
  since?: Date;
  until?: Date;
  package_version_id?: string;
  search?: string;
  rule_id?: string;
  policy_id?: string;
  include_details?: boolean;
  limit?: number;
  offset?: number;
};

export async function listProjectViolationsForMcp(
  ctx: McpRequestContext,
  projectId: string,
  filters: ViolationFilters,
) {
  await requireMcpProjectAccess(ctx.principal, projectId);

  const rows = await listProjectViolations(projectId, ctx.principal.tenantId, {
    status: filters.status,
    severity: filters.severity,
    since: filters.since,
    until: filters.until,
    packageVersionId: filters.package_version_id,
    search: filters.search,
    ruleId: filters.rule_id,
    policyId: filters.policy_id,
    limit: filters.limit ?? 50,
    offset: filters.offset ?? 0,
  });

  const enriched = await enrichViolations(rows);

  const detailMap = filters.include_details
    ? new Map(
        await Promise.all(
          [
            ...new Set(
              enriched
                .map((row) => row.package_version_id)
                .filter((id): id is string => Boolean(id)),
            ),
          ].map(
            async (
              packageVersionId,
            ): Promise<
              [string, Awaited<ReturnType<typeof loadViolationFindings>>]
            > => [
              packageVersionId,
              await loadViolationFindings(
                projectId,
                ctx.principal.tenantId,
                "",
                packageVersionId,
              ),
            ],
          ),
        ),
      )
    : null;

  return {
    tenant_id: ctx.principal.tenantId,
    project_id: projectId,
    violations: enriched.map((violation) => ({
      ...violation,
      ...(detailMap
        ? {
            findings: violation.package_version_id
              ? (detailMap.get(violation.package_version_id)?.findings ?? [])
              : [],
            finding_schemas:
              violation.package_version_id
                ? (detailMap.get(violation.package_version_id)?.findingSchemas ??
                  {})
                : {},
          }
        : {}),
    })),
    limit: filters.limit ?? 50,
    offset: filters.offset ?? 0,
  };
}
