import { afterAll, describe, expect, it } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  contributor_package_facts,
  contributor_release_facts,
  package_versions,
  packages,
  policies,
  policy_rule_bindings,
  project_tokens,
  projects,
  rules,
  tenant_entitlements,
  tenants,
} from "../../db/schema.js";
import { handleCheck } from "../../connect/check-service.js";
import {
  handleRecordPackageContributorMetadata,
  type PackageContributorMetadataInput,
} from "../../connect/record-package-contributor-metadata-service.js";
import { setConnectors } from "../../connectors/runtime.js";
import { ContributorConnector } from "../../connectors/contributor/index.js";
import { ContributorConnectorConfig } from "../../connectors/contributor/config.js";
import type { VerifiedProxyContext } from "../../connect/proxy-context.js";

const TEST_USER_ID = "00000000-0000-0000-0000-000000000099";
const contributorConnector = new ContributorConnector(
  new ContributorConnectorConfig(),
);

setConnectors([contributorConnector]);

afterAll(() => {
  setConnectors([]);
});

type Fixture = {
  tenantId: string;
  projectId: string;
  rawToken: string;
  proxy: VerifiedProxyContext;
  cleanup: () => Promise<void>;
};

async function createFixture(opts?: {
  withPolicy?: boolean;
  ruleCondition?: Record<string, unknown>;
  ruleAction?: Record<string, unknown>;
}): Promise<Fixture> {
  const tenantId = randomUUID();
  const proxyId = randomUUID();
  const rawToken = `it_${randomUUID()}`;
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  await db.insert(tenants).values({
    id: tenantId,
    name: `contributor-it-${tenantId.slice(0, 8)}`,
  });

  const [project] = await db
    .insert(projects)
    .values({
      tenant_id: tenantId,
      name: `project-${tenantId.slice(0, 8)}`,
    })
    .returning({ id: projects.id });

  await db.insert(tenant_entitlements).values({
    tenant_id: tenantId,
    cache_ttl_seconds: 300,
    serve_mode: "SERVE_MODE_REDIRECT",
  });

  await db.insert(project_tokens).values({
    tenant_id: tenantId,
    project_id: project.id,
    name: "integration-token",
    created_by_user_id: TEST_USER_ID,
    token_hash: tokenHash,
    token_prefix: rawToken.slice(-6),
  });

  if (opts?.withPolicy) {
    const [policy] = await db
      .insert(policies)
      .values({
        tenant_id: tenantId,
        name: "integration-policy",
        scope: "global",
        status: "active",
        enforcement_mode: "enforcing",
        priority: 100,
        created_by: TEST_USER_ID,
      })
      .returning({ id: policies.id });

    const [rule] = await db.insert(rules).values({
      tenant_id: tenantId,
      name: "contributor-threshold",
      target_entity: "artifact",
      condition: opts.ruleCondition ?? {
        field: "asset.package",
        operator: "eq",
        value: "__never__",
      },
      action: opts.ruleAction ?? {
        type: "violation",
        enforcement_mode: "enforcing",
        severity: "high",
        code: "INTEGRATION_TEST_BLOCK",
      },
    }).returning({ id: rules.id });

    await db.insert(policy_rule_bindings).values({
      tenant_id: tenantId,
      policy_id: policy.id,
      rule_id: rule.id,
      enabled: true,
      order_index: 0,
    });
  }

  return {
    tenantId,
    projectId: project.id,
    rawToken,
    proxy: {
      proxyId,
      tenantId,
      proxyIp: "127.0.0.1",
    },
    cleanup: async () => {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    },
  };
}

function contributorMetadataMessage(
  pkg: string,
  overrides: Partial<PackageContributorMetadataInput> = {},
): PackageContributorMetadataInput {
  return {
    ecosystem: "npm",
    package: pkg,
    extracted_at: "2026-04-15T00:00:00Z",
    fingerprint: `pkg-fingerprint-${pkg}`,
    latest_version: "1.0.1",
    latest_published_at: "2026-04-15T00:00:00Z",
    history_complete: false,
    oldest_included_published_at: "2026-04-01T00:00:00Z",
    versions: [
      {
        version: "1.0.0",
        published_at: "2026-04-01T00:00:00Z",
        publisher: "alice",
        maintainers: ["alice"],
        has_install_scripts: false,
        has_attestation: false,
        raw_payload_json: JSON.stringify({
          _npmUser: { name: "alice" },
          maintainers: [{ name: "alice" }],
        }),
      },
      {
        version: "1.0.1",
        published_at: "2026-04-15T00:00:00Z",
        publisher: "bob",
        maintainers: ["alice", "bob"],
        has_install_scripts: true,
        has_attestation: true,
        raw_payload_json: JSON.stringify({
          _npmUser: { name: "bob" },
          maintainers: [{ name: "alice" }, { name: "bob" }],
        }),
      },
    ],
    ...overrides,
  };
}

function contributorCheckContext() {
  return {
    requested_version: "1.0.0",
    requested_version_published_at: "2026-04-01T00:00:00Z",
    slice_extracted_at: "2026-04-20T00:00:00Z",
    slice_window_days: 365,
    slice_history_complete: false,
    slice_oldest_included_published_at: "2026-04-01T00:00:00Z",
    package_metadata_fingerprint: "pkg-fingerprint-check",
    slice_fingerprint: "slice-fingerprint-v1",
    versions: [
      {
        version: "1.0.0",
        published_at: "2026-04-01T00:00:00Z",
        publisher: "alice",
        maintainers: ["alice"],
        has_install_scripts: false,
        has_attestation: false,
        raw_payload_json: JSON.stringify({
          _npmUser: { name: "alice" },
          maintainers: [{ name: "alice" }],
        }),
      },
    ],
  };
}

describe("contributor flow integration", () => {
  it("persists contributor metadata sync into package/version facts", async () => {
    const fixture = await createFixture();
    const pkg = `it-metadata-${randomUUID().slice(0, 8)}`;

    try {
      await handleRecordPackageContributorMetadata(
        fixture.proxy,
        contributorMetadataMessage(pkg),
      );

      const [packageRow] = await db
        .select()
        .from(packages)
        .where(and(eq(packages.ecosystem, "npm"), eq(packages.package, pkg)))
        .limit(1);

      expect(packageRow).toBeDefined();
      const [packageFactRow] = await db
        .select()
        .from(contributor_package_facts)
        .where(eq(contributor_package_facts.package_id, packageRow!.id))
        .limit(1);

      expect(packageFactRow?.fingerprint).toBe(`pkg-fingerprint-${pkg}`);

      const versionRows = await db
        .select({
          id: package_versions.id,
          version: package_versions.version,
        })
        .from(package_versions)
        .where(eq(package_versions.package_id, packageRow!.id));

      expect(versionRows).toHaveLength(2);

      const factRows = await db
        .select({
          packageVersionId: contributor_release_facts.package_version_id,
        })
        .from(contributor_release_facts)
        .innerJoin(
          package_versions,
          eq(package_versions.id, contributor_release_facts.package_version_id),
        )
        .where(eq(package_versions.package_id, packageRow!.id));

      expect(factRows).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps package metadata timestamps monotonic across contributor metadata replays", async () => {
    const fixture = await createFixture();
    const pkg = `it-metadata-replay-${randomUUID().slice(0, 8)}`;

    try {
      await handleRecordPackageContributorMetadata(
        fixture.proxy,
        contributorMetadataMessage(pkg, {
          extracted_at: "2026-04-15T00:00:00Z",
          fingerprint: `pkg-fingerprint-${pkg}-newer`,
        }),
      );

      await handleRecordPackageContributorMetadata(
        fixture.proxy,
        contributorMetadataMessage(pkg, {
          extracted_at: "2026-04-10T00:00:00Z",
          fingerprint: `pkg-fingerprint-${pkg}-older`,
        }),
      );

      const [packageRow] = await db
        .select({
          lastMetadataSeenAt: packages.last_metadata_seen_at,
        })
        .from(packages)
        .where(and(eq(packages.ecosystem, "npm"), eq(packages.package, pkg)))
        .limit(1);

      expect(packageRow?.lastMetadataSeenAt?.toISOString()).toBe(
        "2026-04-15T00:00:00.000Z",
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("blocks a check from inline contributor context and persists the slice", async () => {
    const fixture = await createFixture({
      withPolicy: true,
      ruleCondition: {
        field: "source.contributor.contributor_risk_score",
        operator: "gt",
        value: 10,
      },
      ruleAction: {
        type: "violation",
        enforcement_mode: "enforcing",
        severity: "high",
        code: "CONTRIBUTOR_HIGH_RISK",
      },
    });
    const pkg = `it-check-${randomUUID().slice(0, 8)}`;

    try {
      const result = await handleCheck(
        fixture.proxy,
        {
          project_token: fixture.rawToken,
          ecosystem: "npm",
          package: pkg,
          version: "1.0.0",
          trace_id: randomUUID(),
          request_id: randomUUID(),
          span_id: "span-1",
          client_ip: "127.0.0.1",
          proxy_ip: fixture.proxy.proxyIp,
          contributor_context: contributorCheckContext(),
        },
        [contributorConnector],
      );

      expect(result.decision).toBe(2);
      expect(result.reason).toBe("CONTRIBUTOR_HIGH_RISK");

      const [versionRow] = await db
        .select({
          contributorSliceFingerprint:
            contributor_release_facts.contributor_slice_fingerprint,
          contributorSliceObservedAt:
            contributor_release_facts.contributor_slice_observed_at,
        })
        .from(package_versions)
        .innerJoin(packages, eq(packages.id, package_versions.package_id))
        .innerJoin(
          contributor_release_facts,
          eq(contributor_release_facts.package_version_id, package_versions.id),
        )
        .where(
          and(
            eq(packages.ecosystem, "npm"),
            eq(packages.package, pkg),
            eq(package_versions.version, "1.0.0"),
          ),
        )
        .limit(1);

      expect(versionRow?.contributorSliceFingerprint).toBe(
        "slice-fingerprint-v1",
      );
      expect(versionRow?.contributorSliceObservedAt?.toISOString()).toBe(
        "2026-04-20T00:00:00.000Z",
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not reprocess an unchanged contributor slice fingerprint", async () => {
    const fixture = await createFixture({
      withPolicy: true,
      ruleCondition: {
        field: "source.contributor.contributor_risk_score",
        operator: "gt",
        value: 10,
      },
      ruleAction: {
        type: "violation",
        enforcement_mode: "enforcing",
        severity: "high",
        code: "CONTRIBUTOR_HIGH_RISK",
      },
    });
    const pkg = `it-dedupe-${randomUUID().slice(0, 8)}`;

    try {
      const firstContext = contributorCheckContext();
      await handleCheck(
        fixture.proxy,
        {
          project_token: fixture.rawToken,
          ecosystem: "npm",
          package: pkg,
          version: "1.0.0",
          trace_id: randomUUID(),
          request_id: randomUUID(),
          span_id: "span-1",
          client_ip: "127.0.0.1",
          proxy_ip: fixture.proxy.proxyIp,
          contributor_context: firstContext,
        },
        [contributorConnector],
      );

      const [beforeRow] = await db
        .select({
          contributorSliceObservedAt:
            contributor_release_facts.contributor_slice_observed_at,
        })
        .from(package_versions)
        .innerJoin(packages, eq(packages.id, package_versions.package_id))
        .innerJoin(
          contributor_release_facts,
          eq(contributor_release_facts.package_version_id, package_versions.id),
        )
        .where(
          and(
            eq(packages.ecosystem, "npm"),
            eq(packages.package, pkg),
            eq(package_versions.version, "1.0.0"),
          ),
        )
        .limit(1);

      const secondContext = {
        ...contributorCheckContext(),
        slice_extracted_at: "2026-05-01T00:00:00Z",
      };

      await handleCheck(
        fixture.proxy,
        {
          project_token: fixture.rawToken,
          ecosystem: "npm",
          package: pkg,
          version: "1.0.0",
          trace_id: randomUUID(),
          request_id: randomUUID(),
          span_id: "span-2",
          client_ip: "127.0.0.1",
          proxy_ip: fixture.proxy.proxyIp,
          contributor_context: secondContext,
        },
        [contributorConnector],
      );

      const [afterRow] = await db
        .select({
          contributorSliceObservedAt:
            contributor_release_facts.contributor_slice_observed_at,
        })
        .from(package_versions)
        .innerJoin(packages, eq(packages.id, package_versions.package_id))
        .innerJoin(
          contributor_release_facts,
          eq(contributor_release_facts.package_version_id, package_versions.id),
        )
        .where(
          and(
            eq(packages.ecosystem, "npm"),
            eq(packages.package, pkg),
            eq(package_versions.version, "1.0.0"),
          ),
        )
        .limit(1);

      expect(afterRow?.contributorSliceObservedAt?.toISOString()).toBe(
        beforeRow?.contributorSliceObservedAt?.toISOString(),
      );
      expect(afterRow?.contributorSliceObservedAt?.toISOString()).toBe(
        "2026-04-20T00:00:00.000Z",
      );
    } finally {
      await fixture.cleanup();
    }
  });
});
