import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/index.js");
vi.mock("../../connectors/runtime.js", () => ({
  getConnectors: vi.fn(),
}));

import { db } from "../../db/index.js";
import { getConnectors } from "../../connectors/runtime.js";
import { handleRecordPackageContributorMetadata } from "../../connect/record-package-contributor-metadata-service.js";
import { ContributorConnector } from "../../connectors/contributor/index.js";
import { ContributorConnectorConfig } from "../../connectors/contributor/config.js";
import { q, TEST_TENANT_ID } from "../helpers/fakes.js";
import type { VerifiedProxyContext } from "../../connect/proxy-context.js";

function makeProxy(
  overrides: Partial<VerifiedProxyContext> = {},
): VerifiedProxyContext {
  return {
    proxyId: "test-proxy-id",
    tenantId: TEST_TENANT_ID,
    proxyIp: "10.0.0.1",
    ...overrides,
  };
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    ecosystem: "npm",
    package: "pkg",
    extracted_at: "2026-04-15T00:00:00Z",
    fingerprint: "fingerprint-1",
    latest_version: "1.1.0",
    latest_published_at: "2026-04-14T00:00:00Z",
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
      },
      {
        version: "1.1.0",
        published_at: "2026-04-14T00:00:00Z",
        publisher: "bob",
        maintainers: ["alice", "bob"],
        has_install_scripts: true,
        has_attestation: true,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleRecordPackageContributorMetadata", () => {
  it("no-ops when the contributor connector is not registered", async () => {
    vi.mocked(getConnectors).mockReturnValue([]);

    await handleRecordPackageContributorMetadata(makeProxy(), makeMessage());
  });

  it("forwards enriched manifest payloads when the fingerprint changed", async () => {
    const connector = new ContributorConnector(
      new ContributorConnectorConfig(),
    );
    const processPrefetchEvent = vi
      .spyOn(connector, "processPrefetchEvent")
      .mockResolvedValue(undefined);
    vi.mocked(getConnectors).mockReturnValue([connector]);
    await handleRecordPackageContributorMetadata(makeProxy(), makeMessage());

    expect(processPrefetchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ecosystem: "npm",
        package: "pkg",
        fingerprint: "fingerprint-1",
        latestVersion: "1.1.0",
        latestPublishedAt: "2026-04-14T00:00:00Z",
        historyComplete: false,
        oldestIncludedPublishedAt: "2026-04-01T00:00:00Z",
        versions: expect.arrayContaining([
          expect.objectContaining({
            version: "1.1.0",
            publishedAt: "2026-04-14T00:00:00Z",
            publisher: "bob",
            hasInstallScripts: true,
            hasAttestation: true,
          }),
        ]),
      }),
      db,
    );
  });
});
