import { create } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import type { Decision, ServeMode } from "../gen/customs/v1/gateway_pb.js";
import {
  GatewayService,
  CheckResponseSchema,
  RecordUsageResponseSchema,
  RecordProxyStatusResponseSchema,
  RecordPackageLatestMetadataResponseSchema,
  RecordPackageUsedVersionMetadataResponseSchema,
  RecordMetadataCacheStatsResponseSchema,
  RecordPackageContributorMetadataResponseSchema,
} from "../gen/customs/v1/gateway_pb.js";
import type { PackageIntelligenceConnector } from "../connectors/types.js";
import {
  eventTypeToString,
  metadataCacheStatusToString,
  serveModeToString,
} from "./shared.js";
import { handleCheck } from "./check-service.js";
import {
  assertRecordUsageBatchWithinLimit,
  handleRecordUsage,
} from "./record-usage-service.js";
import { handleRecordProxyStatus } from "./record-proxy-status-service.js";
import { handleRecordPackageLatestMetadata } from "./record-package-latest-metadata-service.js";
import { handleRecordPackageUsedVersionMetadata } from "./record-package-used-version-metadata-service.js";
import { handleRecordMetadataCacheStats } from "./record-metadata-cache-stats-service.js";
import { handleRecordPackageContributorMetadata } from "./record-package-contributor-metadata-service.js";
import { log, serializeError } from "../logger.js";
import { ConnectError } from "@connectrpc/connect";
import { requireVerifiedProxyContext } from "./proxy-context.js";
import type { PackageVersionRelatedVersionInput } from "../features/packages/catalog-references.js";

function relatedVersionsFromProto(
  values: Array<{
    version: string;
    versionKind: string;
    artifactKind: string;
    displayRole: string;
    relationshipType: string;
    mediaType: string;
    sizeBytes: bigint;
    platformOs: string;
    platformArch: string;
    platformVariant: string;
    metadataJson: string;
  }>,
) : PackageVersionRelatedVersionInput[] {
  return values.map((value) => ({
    version: value.version,
    version_kind: value.versionKind as PackageVersionRelatedVersionInput["version_kind"],
    artifact_kind: value.artifactKind as PackageVersionRelatedVersionInput["artifact_kind"],
    display_role: value.displayRole as PackageVersionRelatedVersionInput["display_role"],
    relationship_type:
      value.relationshipType as PackageVersionRelatedVersionInput["relationship_type"],
    media_type: value.mediaType || null,
    size_bytes: value.sizeBytes,
    platform_os: value.platformOs || null,
    platform_arch: value.platformArch || null,
    platform_variant: value.platformVariant || null,
    metadata_json: value.metadataJson || null,
  }));
}

export function buildGatewayRoutes(
  router: ConnectRouter,
  connectors: PackageIntelligenceConnector[] = [],
) {
  router.service(GatewayService, {
    async check(req, ctx) {
      const proxy = requireVerifiedProxyContext(ctx);
      const result = await handleCheck(
        proxy,
        {
          project_token: req.projectToken,
          ecosystem: req.ecosystem,
          package: req.package,
          version: req.version,
          trace_id: req.traceId,
          request_id: req.requestId,
          span_id: req.spanId,
          client_ip: req.clientIp || null,
          proxy_ip: proxy.proxyIp,
          requested_ref: req.requestedRef || null,
          resolved_ref: req.resolvedRef || null,
          ref_resolution_source: req.refResolutionSource || null,
          related_versions: relatedVersionsFromProto(req.relatedVersions),
          contributor_context: req.contributorContext
            ? {
                requested_version: req.contributorContext.requestedVersion,
                slice_extracted_at: req.contributorContext.sliceExtractedAt,
                slice_window_days: Number(
                  req.contributorContext.sliceWindowDays,
                ),
                slice_history_complete:
                  req.contributorContext.sliceHistoryComplete,
                slice_oldest_included_published_at:
                  req.contributorContext.sliceOldestIncludedPublishedAt || null,
                package_metadata_fingerprint:
                  req.contributorContext.packageMetadataFingerprint || null,
                slice_fingerprint:
                  req.contributorContext.sliceFingerprint || null,
                versions: req.contributorContext.versions.map((v) => ({
                  version: v.version,
                  published_at: v.publishedAt,
                  publisher: v.publisher || null,
                  maintainers: v.maintainers,
                  has_install_scripts: v.hasInstallScripts,
                  has_attestation: v.hasAttestation,
                  raw_payload_json: v.rawPayloadJson || null,
                })),
              }
            : null,
        },
        connectors,
      );

      return create(CheckResponseSchema, {
        decision: result.decision as Decision,
        reason: result.reason,
        detail: result.detail,
        cacheTtlSeconds: result.cache_ttl_seconds,
        serveMode: result.serve_mode as ServeMode,
        tenantId: result.tenant_id,
        projectId: result.project_id,
      });
    },

    async recordUsage(stream, ctx) {
      try {
        const proxy = requireVerifiedProxyContext(ctx);
        const usageEvents = [];
        let usageEventCount = 0;

        for await (const event of stream) {
          usageEventCount += 1;
          assertRecordUsageBatchWithinLimit(usageEventCount);
          usageEvents.push({
            ecosystem: event.ecosystem,
            package: event.package,
            version: event.version,
            decision: event.decision as number,
            event_type: eventTypeToString(event.eventType),
            decision_cache: event.decisionCache,
            requested_at: event.requestedAt,
            project_token_hash: event.projectTokenHash,
            trace_id: event.traceId,
            request_id: event.requestId,
            tenant_id: event.tenantId,
            project_id: event.projectId,
            serve_mode: serveModeToString(event.serveMode),
            bytes_transferred: Number(event.bytesTransferred),
            client_ip: event.clientIp || null,
            duration_ms: event.durationMs ? Number(event.durationMs) : null,
            decision_path: event.decisionPath || null,
            requested_ref: event.requestedRef || null,
            resolved_ref: event.resolvedRef || null,
            ref_resolution_source: event.refResolutionSource || null,
            related_versions: relatedVersionsFromProto(event.relatedVersions),
          });
        }

        const result = await handleRecordUsage(proxy, usageEvents);

        return create(RecordUsageResponseSchema, { recorded: result.recorded });
      } catch (err) {
        if (err instanceof ConnectError) throw err;
        log.error("record_usage_handler_error", { ...serializeError(err) });
        throw err;
      }
    },

    async recordProxyStatus(req, ctx) {
      const proxy = requireVerifiedProxyContext(ctx);

      await handleRecordProxyStatus(proxy, req.event?.eventType ?? "");

      return create(RecordProxyStatusResponseSchema, {});
    },

    async recordPackageLatestMetadata(req, ctx) {
      const proxy = requireVerifiedProxyContext(ctx);

      await handleRecordPackageLatestMetadata(proxy, {
        ecosystem: req.ecosystem,
        package: req.package,
        latest_version: req.latestVersion,
        latest_published_at: req.latestPublishedAt || null,
        observed_at: req.observedAt,
        cache_status: metadataCacheStatusToString(req.cacheStatus),
      });

      return create(RecordPackageLatestMetadataResponseSchema, {});
    },

    async recordPackageUsedVersionMetadata(req, ctx) {
      const proxy = requireVerifiedProxyContext(ctx);

      await handleRecordPackageUsedVersionMetadata(proxy, {
        ecosystem: req.ecosystem,
        package: req.package,
        used_version: req.usedVersion,
        used_version_published_at: req.usedVersionPublishedAt || null,
        observed_at: req.observedAt,
        cache_status: metadataCacheStatusToString(req.cacheStatus),
        latest_version: req.latestVersion || null,
        latest_published_at: req.latestPublishedAt || null,
      });

      return create(RecordPackageUsedVersionMetadataResponseSchema, {});
    },

    async recordMetadataCacheStats(req, ctx) {
      const proxy = requireVerifiedProxyContext(ctx);

      await handleRecordMetadataCacheStats(proxy, {
        ecosystem: req.ecosystem,
        hits: Number(req.hits),
        misses: Number(req.misses),
        stale_hits: Number(req.staleHits),
        refreshes: Number(req.refreshes),
        parse_failures: Number(req.parseFailures),
        store_failures: Number(req.storeFailures),
        window_started_at: req.windowStartedAt,
        window_ended_at: req.windowEndedAt,
      });

      return create(RecordMetadataCacheStatsResponseSchema, {});
    },

    async recordPackageContributorMetadata(req, ctx) {
      const proxy = requireVerifiedProxyContext(ctx);

      await handleRecordPackageContributorMetadata(proxy, {
        ecosystem: req.ecosystem,
        package: req.package,
        extracted_at: req.extractedAt,
        fingerprint: req.fingerprint || null,
        latest_version: req.latestVersion || null,
        latest_published_at: req.latestPublishedAt || null,
        history_complete: req.historyComplete,
        oldest_included_published_at: req.oldestIncludedPublishedAt || null,
        versions: req.versions.map((v) => ({
          version: v.version,
          published_at: v.publishedAt,
          publisher: v.publisher,
          maintainers: v.maintainers,
          has_install_scripts: v.hasInstallScripts,
          has_attestation: v.hasAttestation,
          raw_payload_json: v.rawPayloadJson || null,
        })),
      });

      return create(RecordPackageContributorMetadataResponseSchema, {});
    },
  });
}
