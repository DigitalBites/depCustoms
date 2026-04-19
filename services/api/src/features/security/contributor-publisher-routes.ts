import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireTenantCapabilityAccess } from "../../http/guards.js";
import { contributorPublishersQuerySchema } from "./shared.js";
import { listTenantContributorPublishers } from "./contributor-package-list-queries.js";
import { toIsoString } from "./serializers.js";

export const contributorPublisherRouter = new Hono();

// ---------------------------------------------------------------------------
// GET /v1/tenants/:tenant_id/connectors/contributor/publishers
// Lists publish actors seen in this tenant's scanned packages, summarized by
// first-time package publishes and prior-version publisher continuity breaks.
// ---------------------------------------------------------------------------

contributorPublisherRouter.get(
  "/v1/tenants/:tenant_id/connectors/contributor/publishers",
  zValidator("query", contributorPublishersQuerySchema),
  async (c) => {
    const tenantId = requireTenantCapabilityAccess(c, "connectors.read");
    if (!tenantId) return c.res;

    const { ecosystem, only_first_time, limit, offset } = c.req.valid("query");

    const { publishers, total } = await listTenantContributorPublishers(
      tenantId,
      {
        ecosystem,
        onlyFirstTime: only_first_time,
        limit,
        offset,
      },
    );

    return c.json({
      publishers: publishers.map((row) => ({
        ecosystem: row.ecosystem,
        publisherName: row.publisher_name,
        packageCount: Number(row.package_count),
        firstTimePublisherCount: Number(row.first_time_publisher_count ?? 0),
        continuityBreakCount: Number(row.continuity_break_count ?? 0),
        lastSeenAt: toIsoString(row.last_seen_at),
      })),
      pagination: { total, offset, limit },
    });
  },
);
