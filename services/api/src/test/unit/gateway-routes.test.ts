import { beforeEach, describe, expect, it, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";

vi.mock("../../connect/check-service.js", () => ({
  handleCheck: vi.fn(),
}));

vi.mock("../../connect/record-usage-service.js", () => ({
  assertRecordUsageBatchWithinLimit: vi.fn(),
  handleRecordUsage: vi.fn(),
}));

vi.mock("../../connect/record-proxy-status-service.js", () => ({
  handleRecordProxyStatus: vi.fn(),
}));

vi.mock("../../connect/record-package-latest-metadata-service.js", () => ({
  handleRecordPackageLatestMetadata: vi.fn(),
}));

vi.mock(
  "../../connect/record-package-used-version-metadata-service.js",
  () => ({
    handleRecordPackageUsedVersionMetadata: vi.fn(),
  }),
);

vi.mock("../../connect/record-metadata-cache-stats-service.js", () => ({
  handleRecordMetadataCacheStats: vi.fn(),
}));

vi.mock("../../connect/record-package-contributor-metadata-service.js", () => ({
  handleRecordPackageContributorMetadata: vi.fn(),
}));

vi.mock("../../connect/proxy-context.js", () => ({
  requireVerifiedProxyContext: vi.fn(),
}));

vi.mock("../../logger.js", () => ({
  log: {
    error: vi.fn(),
  },
  serializeError: (err: unknown) => ({
    message: err instanceof Error ? err.message : String(err),
  }),
}));

import { buildGatewayRoutes } from "../../connect/gateway-routes.js";
import {
  Decision,
  EventType,
  MetadataCacheStatus,
  ServeMode,
} from "../../gen/customs/v1/gateway_pb.js";
import { handleCheck } from "../../connect/check-service.js";
import {
  assertRecordUsageBatchWithinLimit,
  handleRecordUsage,
} from "../../connect/record-usage-service.js";
import { handleRecordProxyStatus } from "../../connect/record-proxy-status-service.js";
import { handleRecordPackageLatestMetadata } from "../../connect/record-package-latest-metadata-service.js";
import { handleRecordPackageUsedVersionMetadata } from "../../connect/record-package-used-version-metadata-service.js";
import { handleRecordMetadataCacheStats } from "../../connect/record-metadata-cache-stats-service.js";
import { handleRecordPackageContributorMetadata } from "../../connect/record-package-contributor-metadata-service.js";
import { requireVerifiedProxyContext } from "../../connect/proxy-context.js";

type GatewayHandlers = ReturnType<typeof captureGatewayHandlers>;

function captureGatewayHandlers() {
  let handlers: any;
  const router = {
    service: vi.fn((_service: unknown, impl: unknown) => {
      handlers = impl;
    }),
  };

  buildGatewayRoutes(router as any, [{ id: "mock-connector" }] as any);
  return handlers as {
    check: (req: any, ctx: any) => Promise<any>;
    recordUsage: (stream: AsyncIterable<any>, ctx: any) => Promise<any>;
    recordProxyStatus: (req: any, ctx: any) => Promise<any>;
    recordPackageLatestMetadata: (req: any, ctx: any) => Promise<any>;
    recordPackageUsedVersionMetadata: (req: any, ctx: any) => Promise<any>;
    recordMetadataCacheStats: (req: any, ctx: any) => Promise<any>;
    recordPackageContributorMetadata: (req: any, ctx: any) => Promise<any>;
  };
}

async function* asStream<T>(items: T[]) {
  for (const item of items) {
    yield item;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireVerifiedProxyContext).mockReturnValue({
    proxyId: "proxy-1",
    tenantId: "tenant-1",
    proxyIp: "10.0.0.1",
  });
  vi.mocked(handleCheck).mockResolvedValue({
    decision: Decision.ALLOW,
    reason: "allowed",
    detail: "ok",
    cache_ttl_seconds: 300,
    serve_mode: ServeMode.REDIRECT,
    tenant_id: "tenant-1",
    project_id: "project-1",
  });
  vi.mocked(handleRecordUsage).mockResolvedValue({ recorded: 1 });
  vi.mocked(handleRecordProxyStatus).mockResolvedValue(undefined);
  vi.mocked(handleRecordPackageLatestMetadata).mockResolvedValue(undefined);
  vi.mocked(handleRecordPackageUsedVersionMetadata).mockResolvedValue(
    undefined,
  );
  vi.mocked(handleRecordMetadataCacheStats).mockResolvedValue(undefined);
  vi.mocked(handleRecordPackageContributorMetadata).mockResolvedValue(
    undefined,
  );
});

describe("buildGatewayRoutes", () => {
  it("maps check requests into handleCheck and returns a protobuf response shape", async () => {
    const handlers = captureGatewayHandlers();

    const response = await handlers.check(
      {
        projectToken: "tok",
        ecosystem: "npm",
        package: "lodash",
        version: "4.17.15",
        traceId: "trace-1",
        requestId: "req-1",
        spanId: "span-1",
        clientIp: "1.2.3.4",
        contributorContext: {
          requestedVersion: "4.17.15",
          requestedVersionPublishedAt: "2026-04-01T00:00:00Z",
          sliceExtractedAt: "2026-04-02T00:00:00Z",
          sliceWindowDays: 30,
          sliceHistoryComplete: true,
          sliceOldestIncludedPublishedAt: "2026-03-01T00:00:00Z",
          packageMetadataFingerprint: "pkg-fp",
          sliceFingerprint: "slice-fp",
          versions: [
            {
              version: "4.17.15",
              publishedAt: "2026-04-01T00:00:00Z",
              publisher: "alice",
              maintainers: ["alice"],
              hasInstallScripts: false,
              hasAttestation: true,
              rawPayloadJson: "{}",
            },
          ],
        },
      },
      { values: new Map() },
    );

    expect(handleCheck).toHaveBeenCalledWith(
      { proxyId: "proxy-1", tenantId: "tenant-1", proxyIp: "10.0.0.1" },
      expect.objectContaining({
        project_token: "tok",
        ecosystem: "npm",
        package: "lodash",
        version: "4.17.15",
        contributor_context: expect.objectContaining({
          requested_version: "4.17.15",
          slice_window_days: 30,
          versions: [
            expect.objectContaining({
              publisher: "alice",
              has_attestation: true,
            }),
          ],
        }),
      }),
      [{ id: "mock-connector" }],
    );
    expect(response).toMatchObject({
      decision: Decision.ALLOW,
      reason: "allowed",
      detail: "ok",
      cacheTtlSeconds: 300,
      serveMode: ServeMode.REDIRECT,
      tenantId: "tenant-1",
      projectId: "project-1",
    });
  });

  it("records usage batches with mapped enum values", async () => {
    const handlers = captureGatewayHandlers();

    const response = await handlers.recordUsage(
      asStream([
        {
          ecosystem: "npm",
          package: "lodash",
          version: "4.17.15",
          decision: Decision.BLOCK,
          eventType: EventType.UPSTREAM_ERROR,
          decisionCache: false,
          requestedAt: "2026-04-01T00:00:00Z",
          projectTokenHash: "hash",
          traceId: "trace-1",
          requestId: "req-1",
          tenantId: "tenant-1",
          projectId: "project-1",
          serveMode: ServeMode.PULL,
          bytesTransferred: BigInt(42),
          clientIp: "1.2.3.4",
          durationMs: BigInt(9),
          decisionPath: "check",
        },
      ]),
      { values: new Map() },
    );

    expect(assertRecordUsageBatchWithinLimit).toHaveBeenCalledWith(1);
    expect(handleRecordUsage).toHaveBeenCalledWith(
      { proxyId: "proxy-1", tenantId: "tenant-1", proxyIp: "10.0.0.1" },
      [
        expect.objectContaining({
          event_type: "upstream_error",
          serve_mode: "SERVE_MODE_PULL",
          bytes_transferred: 42,
          duration_ms: 9,
          decision_path: "check",
        }),
      ],
    );
    expect(response).toMatchObject({ recorded: 1 });
  });

  it("logs and rethrows unexpected recordUsage errors", async () => {
    vi.mocked(handleRecordUsage).mockRejectedValueOnce(new Error("unexpected"));
    const handlers = captureGatewayHandlers();

    await expect(
      handlers.recordUsage(
        asStream([
          {
            ecosystem: "npm",
            package: "lodash",
            version: "4.17.15",
            decision: Decision.ALLOW,
            eventType: EventType.ARTIFACT,
            decisionCache: true,
            requestedAt: "2026-04-01T00:00:00Z",
            projectTokenHash: "hash",
            traceId: "trace-1",
            requestId: "req-1",
            tenantId: "tenant-1",
            projectId: "project-1",
            serveMode: ServeMode.REDIRECT,
            bytesTransferred: BigInt(0),
            clientIp: null,
            durationMs: BigInt(5),
            decisionPath: null,
          },
        ]),
        { values: new Map() },
      ),
    ).rejects.toThrow("unexpected");
  });

  it("rejects unknown recordUsage event types", async () => {
    const handlers = captureGatewayHandlers();

    await expect(
      handlers.recordUsage(
        asStream([
          {
            ecosystem: "npm",
            package: "lodash",
            version: "4.17.15",
            decision: Decision.ALLOW,
            eventType: EventType.UNSPECIFIED,
            decisionCache: true,
            requestedAt: "2026-04-01T00:00:00Z",
            projectTokenHash: "hash",
            traceId: "trace-1",
            requestId: "req-1",
            tenantId: "tenant-1",
            projectId: "project-1",
            serveMode: ServeMode.REDIRECT,
            bytesTransferred: BigInt(0),
            clientIp: null,
            durationMs: BigInt(5),
            decisionPath: null,
          },
        ]),
        { values: new Map() },
      ),
    ).rejects.toThrow("unknown request event type");

    expect(handleRecordUsage).not.toHaveBeenCalled();
  });

  it("passes proxy status events through", async () => {
    const handlers = captureGatewayHandlers();

    await handlers.recordProxyStatus(
      { event: { eventType: "disabled" } },
      { values: new Map() },
    );

    expect(handleRecordProxyStatus).toHaveBeenCalledWith(
      { proxyId: "proxy-1", tenantId: "tenant-1", proxyIp: "10.0.0.1" },
      "disabled",
    );
  });

  it("maps metadata cache enums for package metadata recording", async () => {
    const handlers = captureGatewayHandlers();

    await handlers.recordPackageLatestMetadata(
      {
        ecosystem: "npm",
        package: "lodash",
        latestVersion: "5.0.0",
        latestPublishedAt: "2026-04-01T00:00:00Z",
        observedAt: "2026-04-02T00:00:00Z",
        cacheStatus: MetadataCacheStatus.REFRESH,
      },
      { values: new Map() },
    );

    await handlers.recordPackageUsedVersionMetadata(
      {
        ecosystem: "npm",
        package: "lodash",
        usedVersion: "4.17.15",
        usedVersionPublishedAt: "2026-03-01T00:00:00Z",
        observedAt: "2026-04-02T00:00:00Z",
        cacheStatus: MetadataCacheStatus.STALE,
        latestVersion: "5.0.0",
        latestPublishedAt: "2026-04-01T00:00:00Z",
      },
      { values: new Map() },
    );

    expect(handleRecordPackageLatestMetadata).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cache_status: "refresh" }),
    );
    expect(handleRecordPackageUsedVersionMetadata).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cache_status: "stale" }),
    );
  });

  it("records cache stats and contributor metadata payloads", async () => {
    const handlers = captureGatewayHandlers();

    await handlers.recordMetadataCacheStats(
      {
        ecosystem: "npm",
        hits: BigInt(10),
        misses: BigInt(2),
        staleHits: BigInt(1),
        refreshes: BigInt(3),
        parseFailures: BigInt(0),
        storeFailures: BigInt(0),
        windowStartedAt: "2026-04-01T00:00:00Z",
        windowEndedAt: "2026-04-02T00:00:00Z",
      },
      { values: new Map() },
    );

    await handlers.recordPackageContributorMetadata(
      {
        ecosystem: "npm",
        package: "lodash",
        extractedAt: "2026-04-02T00:00:00Z",
        fingerprint: "fp",
        latestVersion: "5.0.0",
        latestPublishedAt: "2026-04-01T00:00:00Z",
        historyComplete: false,
        oldestIncludedPublishedAt: "2026-03-01T00:00:00Z",
        versions: [
          {
            version: "4.17.15",
            publishedAt: "2026-03-01T00:00:00Z",
            publisher: "alice",
            maintainers: ["alice"],
            hasInstallScripts: false,
            hasAttestation: true,
            rawPayloadJson: "{}",
          },
        ],
      },
      { values: new Map() },
    );

    expect(handleRecordMetadataCacheStats).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hits: 10, refreshes: 3 }),
    );
    expect(handleRecordPackageContributorMetadata).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fingerprint: "fp",
        versions: [expect.objectContaining({ publisher: "alice" })],
      }),
    );
  });

  it("rethrows ConnectError instances without wrapping them", async () => {
    vi.mocked(handleRecordUsage).mockRejectedValueOnce(
      new ConnectError("invalid_proxy_token", Code.Unauthenticated),
    );
    const handlers = captureGatewayHandlers();

    await expect(
      handlers.recordUsage(
        asStream([
          {
            ecosystem: "npm",
            package: "lodash",
            version: "4.17.15",
            decision: Decision.ALLOW,
            eventType: EventType.ARTIFACT,
            decisionCache: false,
            requestedAt: "2026-04-01T00:00:00Z",
            projectTokenHash: "hash",
            traceId: "trace-1",
            requestId: "req-1",
            tenantId: "tenant-1",
            projectId: "project-1",
            serveMode: ServeMode.REDIRECT,
            bytesTransferred: BigInt(1),
            clientIp: null,
            durationMs: BigInt(1),
            decisionPath: null,
          },
        ]),
        { values: new Map() },
      ),
    ).rejects.toMatchObject({
      code: Code.Unauthenticated,
      rawMessage: "invalid_proxy_token",
    });
  });
});
