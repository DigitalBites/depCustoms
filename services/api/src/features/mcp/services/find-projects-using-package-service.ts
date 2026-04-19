import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { canPerform } from "../../../middleware/rbac.js";
import type { McpRequestContext } from "../context.js";
import { McpToolExecutionError } from "../tool-registry.js";
import { db } from "../../../db/index.js";
import {
  packages,
  package_versions,
  project_package_usage,
  projects,
} from "../../../db/schema.js";
import { toIsoString } from "./package-guidance-service.js";

const latestPackageVersions = alias(
  package_versions,
  "mcp_find_projects_latest_package_versions",
);

type FindProjectsUsingPackageInput = {
  ecosystem: string;
  packageName: string;
  version?: string | null;
  limit?: number;
  offset?: number;
};

export async function findProjectsUsingPackageForMcp(
  ctx: McpRequestContext,
  input: FindProjectsUsingPackageInput,
) {
  if (!canPerform(ctx.principal.role, "mcp.use_tenant")) {
    throw new McpToolExecutionError(
      "Tenant-wide MCP package usage access is required",
    );
  }

  const limit = input.limit ?? 100;
  const offset = input.offset ?? 0;
  const whereClause = and(
    eq(project_package_usage.tenant_id, ctx.principal.tenantId),
    eq(projects.tenant_id, ctx.principal.tenantId),
    eq(packages.ecosystem, input.ecosystem),
    eq(packages.package, input.packageName),
    ...(input.version ? [eq(package_versions.version, input.version)] : []),
  );

  const [rows, [countRow]] = await Promise.all([
    db
      .select({
        project_id: projects.id,
        project_name: projects.name,
        ecosystem: packages.ecosystem,
        package: packages.package,
        version: package_versions.version,
        used_version_published_at: package_versions.published_at,
        is_latest: sql<
          boolean | null
        >`${packages.latest_package_version_id} = ${package_versions.id}`,
        latest_version: latestPackageVersions.version,
        latest_version_published_at: latestPackageVersions.published_at,
        request_count: project_package_usage.request_count,
        allow_count: project_package_usage.allow_count,
        block_count: project_package_usage.block_count,
        first_seen_at: project_package_usage.created_at,
        last_seen_at: project_package_usage.updated_at,
      })
      .from(project_package_usage)
      .innerJoin(projects, eq(project_package_usage.project_id, projects.id))
      .innerJoin(
        package_versions,
        eq(project_package_usage.package_version_id, package_versions.id),
      )
      .innerJoin(packages, eq(package_versions.package_id, packages.id))
      .leftJoin(
        latestPackageVersions,
        eq(packages.latest_package_version_id, latestPackageVersions.id),
      )
      .where(whereClause)
      .orderBy(
        sql`${projects.name} ASC`,
        sql`${project_package_usage.updated_at} DESC`,
      )
      .limit(limit)
      .offset(offset),
    db
      .select({
        count: sql<string>`count(*)`,
      })
      .from(project_package_usage)
      .innerJoin(projects, eq(project_package_usage.project_id, projects.id))
      .innerJoin(
        package_versions,
        eq(project_package_usage.package_version_id, package_versions.id),
      )
      .innerJoin(packages, eq(package_versions.package_id, packages.id))
      .where(whereClause),
  ]);

  return {
    tenant_id: ctx.principal.tenantId,
    ecosystem: input.ecosystem,
    package: input.packageName,
    version: input.version ?? null,
    project_count: new Set(rows.map((row) => row.project_id)).size,
    pagination: {
      total: Number(countRow?.count ?? 0),
      offset,
      limit,
    },
    results: rows.map((row) => ({
      project_id: row.project_id,
      project_name: row.project_name,
      version: row.version,
      used_version_published_at: toIsoString(row.used_version_published_at),
      latest_version: row.latest_version,
      latest_version_published_at: toIsoString(row.latest_version_published_at),
      is_latest: row.is_latest,
      request_count: row.request_count,
      allow_count: row.allow_count,
      block_count: row.block_count,
      first_seen_at: toIsoString(row.first_seen_at),
      last_seen_at: toIsoString(row.last_seen_at),
    })),
  };
}
