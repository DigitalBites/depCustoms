/**
 * OSV connector — implements PackageIntelligenceConnector using the
 * OSV.dev vulnerability API (https://osv.dev).
 *
 * This connector is a pure fetch layer. It does not manage caching —
 * that responsibility belongs to cache.ts. It is only called on a cache
 * miss or when a cached entry has become stale.
 */

import type {
  ConnectorField,
  ConnectorFindingField,
  ConnectorRequestContext,
  ConnectorPresentation,
  ConnectorResult,
  ConnectorSnapshot,
  ConnectorSnapshotMeta,
  EntityContext,
  PackageIntelligenceConnector,
} from "../types.js";
import type { OsvConnectorConfig } from "./config.js";
import { OsvHttpClient } from "./client.js";
import { parseOsvResponse } from "./parse.js";
import { buildDefaultConnectorPresentation } from "../presentation.js";
import { log } from "../../logger.js";

// OSV ecosystem names are case-sensitive. Map our internal lowercase names.
const OSV_ECOSYSTEM_MAP: Record<string, string> = {
  npm: "npm",
  pypi: "PyPI",
};

export class OsvConnector implements PackageIntelligenceConnector {
  readonly id = "osv";
  readonly config: OsvConnectorConfig;
  private client: OsvHttpClient;

  constructor(config: OsvConnectorConfig) {
    this.config = config;
    this.client = new OsvHttpClient(config.baseUrl, config.backgroundTimeoutMs);
  }

  async initialize(): Promise<void> {
    // undici Agent is lazily initialised — no explicit setup required.
    // Future: ping /v1/query with a known-safe package to warm the connection pool.
  }

  async fetchSignals(
    ecosystem: string,
    pkg: string,
    version: string,
    _requestContext?: ConnectorRequestContext,
  ): Promise<ConnectorResult> {
    const osvEcosystem = OSV_ECOSYSTEM_MAP[ecosystem.toLowerCase()];

    if (!osvEcosystem) {
      log.debug("connector_ecosystem_unsupported", {
        component: "policy_connectors",
        connector: this.id,
        ecosystem,
        package: pkg,
        version,
      });
      return {
        summary: {
          vulnerability: {
            maxSeverity: "NONE",
            findingCount: 0,
            fixAvailable: false,
            bestFixVersion: null,
          },
        },
        findings: [],
      };
    }

    log.debug("connector_fetch_start", {
      component: "policy_connectors",
      connector: this.id,
      ecosystem,
      package: pkg,
      version,
      osv_ecosystem: osvEcosystem,
    });

    const raw = await this.client.query(osvEcosystem, pkg, version);
    return parseOsvResponse(raw, pkg, ecosystem, version);
  }

  async shutdown(): Promise<void> {
    await this.client.close();
  }

  getFieldCatalog(): ConnectorField[] {
    const key = this.id; // 'osv'
    const intOps = ["eq", "ne", "gt", "gte", "lt", "lte"];
    const strOps = ["eq", "ne", "in", "not_in"];
    const boolOps = ["is_true", "is_false"];
    const floatOps = ["gt", "gte", "lt", "lte"];
    const metaStrOps = ["eq", "ne", "in", "not_in", "exists", "not_exists"];
    const anyOps = ["exists", "not_exists", "eq", "ne"];

    return [
      // ----------------------------------------------------------------
      // Data fields
      // ----------------------------------------------------------------
      {
        connectorKey: key,
        fieldKey: "critical_count",
        canonicalRef: "source.osv.critical_count",
        label: "Critical CVE Count",
        description: "Number of critical severity vulnerabilities found by OSV",
        dataType: "integer",
        entityType: "artifact",
        operators: intOps,
      },
      {
        connectorKey: key,
        fieldKey: "high_count",
        canonicalRef: "source.osv.high_count",
        label: "High CVE Count",
        description: "Number of high severity vulnerabilities found by OSV",
        dataType: "integer",
        entityType: "artifact",
        operators: intOps,
      },
      {
        connectorKey: key,
        fieldKey: "medium_count",
        canonicalRef: "source.osv.medium_count",
        label: "Medium CVE Count",
        description: "Number of medium severity vulnerabilities found by OSV",
        dataType: "integer",
        entityType: "artifact",
        operators: intOps,
      },
      {
        connectorKey: key,
        fieldKey: "low_count",
        canonicalRef: "source.osv.low_count",
        label: "Low CVE Count",
        description: "Number of low severity vulnerabilities found by OSV",
        dataType: "integer",
        entityType: "artifact",
        operators: intOps,
      },
      {
        connectorKey: key,
        fieldKey: "vuln_count",
        canonicalRef: "source.osv.vuln_count",
        label: "Total Vulnerability Count",
        description: "Total number of vulnerabilities found by OSV",
        dataType: "integer",
        entityType: "artifact",
        operators: intOps,
      },
      {
        connectorKey: key,
        fieldKey: "max_severity",
        canonicalRef: "source.osv.max_severity",
        label: "Maximum Severity",
        description: "Highest severity level across all found vulnerabilities",
        dataType: "string",
        entityType: "artifact",
        operators: strOps,
        enumValues: ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"],
      },
      {
        connectorKey: key,
        fieldKey: "fix_available",
        canonicalRef: "source.osv.fix_available",
        label: "Fix Available",
        description: "Whether at least one vulnerability has a known fix",
        dataType: "boolean",
        entityType: "artifact",
        operators: boolOps,
      },
      {
        connectorKey: key,
        fieldKey: "best_fix_version",
        canonicalRef: "source.osv.best_fix_version",
        label: "Best Fix Version",
        description:
          "Highest fix version across all vulnerabilities; null if none",
        dataType: "string",
        entityType: "artifact",
        operators: anyOps,
      },
      {
        connectorKey: key,
        fieldKey: "scan_age_hours",
        canonicalRef: "source.osv.scan_age_hours",
        label: "Scan Age (hours)",
        description: "How many hours ago this scan result was fetched",
        dataType: "float",
        entityType: "artifact",
        operators: floatOps,
      },
      // ----------------------------------------------------------------
      // _meta fields — always present, even on failure
      // ----------------------------------------------------------------
      {
        connectorKey: key,
        fieldKey: "_meta.status",
        canonicalRef: "source.osv._meta.status",
        label: "Connector Status",
        description: "Response status of the OSV connector for this request",
        dataType: "string",
        entityType: "artifact",
        operators: metaStrOps,
        enumValues: [
          "ok",
          "cache_hit",
          "timeout",
          "unavailable",
          "error",
          "background_pending",
        ],
      },
      {
        connectorKey: key,
        fieldKey: "_meta.response_time_ms",
        canonicalRef: "source.osv._meta.response_time_ms",
        label: "Response Time (ms)",
        description: "How long the OSV connector call took; 0 for cache hits",
        dataType: "integer",
        entityType: "artifact",
        operators: intOps,
      },
      {
        connectorKey: key,
        fieldKey: "_meta.cache_age_hours",
        canonicalRef: "source.osv._meta.cache_age_hours",
        label: "Cache Age (hours)",
        description:
          "Hours since the cached result was written; null on fresh fetch",
        dataType: "float",
        entityType: "artifact",
        operators: floatOps,
      },
      {
        connectorKey: key,
        fieldKey: "_meta.is_cache_hit",
        canonicalRef: "source.osv._meta.is_cache_hit",
        label: "Is Cache Hit",
        description: "True if served from connector cache, false if fresh",
        dataType: "boolean",
        entityType: "artifact",
        operators: boolOps,
      },
      {
        connectorKey: key,
        fieldKey: "_meta.error_code",
        canonicalRef: "source.osv._meta.error_code",
        label: "Error Code",
        description: "Machine-readable error code when status is not ok",
        dataType: "string",
        entityType: "artifact",
        operators: anyOps,
      },
    ];
  }

  getFindingSchema(): ConnectorFindingField[] {
    return [
      { key: "osv_id", label: "OSV ID", dataType: "string", display: "code" },
      {
        key: "aliases",
        label: "Aliases",
        dataType: "string[]",
        display: "badge",
      },
      {
        key: "cvss_v3_score",
        label: "CVSS v3",
        dataType: "float",
        display: "number",
      },
      {
        key: "attack_vector",
        label: "Attack Vector",
        dataType: "string",
        display: "badge",
      },
      {
        key: "attack_complexity",
        label: "Attack Complexity",
        dataType: "string",
        display: "badge",
      },
      {
        key: "privileges_required",
        label: "Privileges Required",
        dataType: "string",
        display: "badge",
      },
      {
        key: "fix_version",
        label: "Fix Version",
        dataType: "string",
        display: "code",
      },
      {
        key: "fix_reference_urls",
        label: "References",
        dataType: "string[]",
        display: "url",
      },
      {
        key: "cwe_ids",
        label: "CWE IDs",
        dataType: "string[]",
        display: "badge",
      },
      {
        key: "has_exploit_evidence",
        label: "Exploit Evidence",
        dataType: "boolean",
        display: "badge",
      },
    ];
  }

  normalizeToSnapshot(
    result: ConnectorResult | null,
    context: EntityContext,
    failureStatus?: ConnectorSnapshotMeta["status"],
    errorCode?: string,
  ): ConnectorSnapshot {
    const meta: ConnectorSnapshotMeta = {
      status: failureStatus ?? (context.isCacheHit ? "cache_hit" : "ok"),
      responseTimeMs: context.responseTimeMs,
      cacheAgeHours: context.cacheAgeHours,
      isCacheHit: context.isCacheHit,
      ...(errorCode ? { errorCode } : {}),
    };

    if (!result || failureStatus) {
      return {
        connectorKey: this.id,
        entityType: "artifact",
        packageId: context.packageId,
        packageVersionId: context.packageVersionId,
        ecosystem: context.ecosystem,
        packageName: context.pkg,
        version: context.version,
        displayName: context.displayName,
        fields: {},
        meta,
        observedAt: new Date().toISOString(),
      };
    }

    const vulnerability = result.summary?.vulnerability;
    const counts = vulnerability?.severityCounts ?? {
      critical: result.findings.filter((v) => v.severity === "CRITICAL").length,
      high: result.findings.filter((v) => v.severity === "HIGH").length,
      medium: result.findings.filter((v) => v.severity === "MEDIUM").length,
      low: result.findings.filter((v) => v.severity === "LOW").length,
    };

    return {
      connectorKey: this.id,
      entityType: "artifact",
      packageId: context.packageId,
      packageVersionId: context.packageVersionId,
      ecosystem: context.ecosystem,
      packageName: context.pkg,
      version: context.version,
      displayName: context.displayName,
      fields: {
        critical_count: counts.critical,
        high_count: counts.high,
        medium_count: counts.medium,
        low_count: counts.low,
        vuln_count: vulnerability?.findingCount ?? result.findings.length,
        max_severity: vulnerability?.maxSeverity ?? "NONE",
        fix_available: vulnerability?.fixAvailable ?? false,
        best_fix_version: vulnerability?.bestFixVersion ?? null,
        scan_age_hours: context.cacheAgeHours,
      },
      meta,
      observedAt: new Date().toISOString(),
    };
  }

  buildPresentation(
    result: ConnectorResult | null,
    snapshot: ConnectorSnapshot,
  ): ConnectorPresentation {
    return buildDefaultConnectorPresentation(
      result,
      snapshot,
      this.getFindingSchema(),
      { connectorLabel: "OSV" },
    );
  }
}
