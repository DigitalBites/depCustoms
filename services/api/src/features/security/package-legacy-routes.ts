import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { connector_cache } from "../../db/schema.js";
import {
  getAuthContext,
  requireProjectAccess,
  requireTenantCapability,
} from "../../http/guards.js";
import { pagedPackagesQuerySchema } from "./shared.js";
import { listLegacyProjectVulnerablePackages } from "./package-list-queries.js";
import type { CacheFinding } from "../../connectors/cache.js";

export const projectSecurityPackageLegacyRouter = new Hono();

projectSecurityPackageLegacyRouter.get(
  "/v1/projects/:project_id/vulnerable-packages",
  zValidator("query", pagedPackagesQuerySchema),
  async (c) => {
    if (!requireTenantCapability(c, "packages.read_project", "Access denied")) {
      return c.res;
    }

    const access = await requireProjectAccess(c);
    if (!access) return c.res;

    const { projectId } = access;
    const { tenantId } = getAuthContext(c);
    const { offset, limit } = c.req.valid("query");
    const { vulnPackages, total } = await listLegacyProjectVulnerablePackages(
      projectId,
      tenantId,
      offset,
      limit,
    );

    if (vulnPackages.length === 0) {
      return c.json({ packages: [], pagination: { total, offset, limit } });
    }

    const cacheIds = vulnPackages.map((pkg) => pkg.cacheId);
    const cacheRows = await db
      .select({ id: connector_cache.id, data: connector_cache.data })
      .from(connector_cache)
      .where(
        and(
          inArray(connector_cache.id, cacheIds),
          eq(connector_cache.connector_id, "osv"),
        ),
      );

    // Extract findings from data JSONB, grouped by cache row id
    const vulnsByCacheId = new Map<string, CacheFinding[]>();
    for (const row of cacheRows) {
      const findings =
        (row.data as { findings?: CacheFinding[] } | null)?.findings ?? [];
      vulnsByCacheId.set(row.id, findings);
    }

    const packagesResponse = vulnPackages.map((pkg) => {
      const vulns = vulnsByCacheId.get(pkg.cacheId) ?? [];
      return {
        ecosystem: pkg.ecosystem,
        name: pkg.name,
        version: pkg.version,
        maxSeverity: pkg.osvMaxSeverity,
        vulnCount: pkg.osvFindingCount,
        fixAvailable: pkg.osvFixAvailable,
        bestFixVersion: pkg.osvBestFixVersion,
        networkExploitable: vulns.some(
          (vuln) => vuln.attributes?.attack_vector === "NETWORK",
        ),
        lastPulledAt: pkg.lastPulledAt?.toISOString() ?? null,
        vulns: vulns.map((vuln) => {
          const attributes = vuln.attributes ?? {};
          return {
            osvId: vuln.id,
            aliases: (attributes.aliases as string[]) ?? [],
            summary: vuln.title,
            severity: vuln.severity,
            cvssV3Score:
              attributes.cvss_v3_score !== null &&
              attributes.cvss_v3_score !== undefined
                ? Number(attributes.cvss_v3_score)
                : null,
            attackVector: (attributes.attack_vector as string | null) ?? null,
            fixVersion: (attributes.fix_version as string | null) ?? null,
            cweIds: (attributes.cwe_ids as string[]) ?? [],
            publishedAt: vuln.published_at ?? null,
            daysSincePublished: vuln.published_at
              ? Math.floor(
                  (Date.now() - new Date(vuln.published_at).getTime()) /
                    86_400_000,
                )
              : null,
          };
        }),
      };
    });

    return c.json({
      packages: packagesResponse,
      pagination: { total, offset, limit },
    });
  },
);
