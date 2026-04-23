import type {
  ConnectorFinding,
  ConnectorFindingField,
  ConnectorFindingSummary,
  ConnectorPresentation,
  ConnectorResult,
  ConnectorSnapshot,
  ConnectorUiBadge,
  ConnectorUiDisposition,
  ConnectorUiFact,
  ConnectorUiSummary,
  VulnerabilitySummary,
  VulnSeverity,
} from "./types.js";

type ConnectorResultLike = ConnectorResult | null;

interface PresentationOptions {
  connectorLabel: string;
  buildSummary?: (
    result: ConnectorResultLike,
    snapshot: ConnectorSnapshot,
  ) => ConnectorUiSummary;
}

const STATUS_HEADLINES: Record<ConnectorSnapshot["meta"]["status"], string> = {
  ok: "Result ready",
  cache_hit: "Cached result ready",
  timeout: "Connector timed out",
  unavailable: "Connector unavailable",
  error: "Connector error",
  background_pending: "Result pending",
};

const SEVERITY_TONE: Record<VulnSeverity, ConnectorUiBadge["tone"]> = {
  CRITICAL: "bad",
  HIGH: "bad",
  MEDIUM: "warn",
  LOW: "neutral",
  NONE: "good",
};

const DEFAULT_FAILURE_DISPOSITION: Record<
  ConnectorSnapshot["meta"]["status"],
  ConnectorUiDisposition
> = {
  ok: "info",
  cache_hit: "info",
  timeout: "unavailable",
  unavailable: "unavailable",
  error: "unavailable",
  background_pending: "info",
};

export function buildDefaultConnectorPresentation(
  result: ConnectorResultLike,
  snapshot: ConnectorSnapshot,
  findingSchema: ConnectorFindingField[],
  options: PresentationOptions,
): ConnectorPresentation {
  return {
    summary:
      options.buildSummary?.(result, snapshot) ??
      buildDefaultSummary(options.connectorLabel, result, snapshot),
    findings: buildFindingSummaries(result?.findings ?? []),
    findingSchema,
  };
}

function buildDefaultSummary(
  connectorLabel: string,
  result: ConnectorResultLike,
  snapshot: ConnectorSnapshot,
): ConnectorUiSummary {
  if (snapshot.meta.status !== "ok" && snapshot.meta.status !== "cache_hit") {
    return {
      status: snapshot.meta.status,
      headline: `${connectorLabel}: ${STATUS_HEADLINES[snapshot.meta.status]}`,
      disposition: DEFAULT_FAILURE_DISPOSITION[snapshot.meta.status],
      badges: buildStatusBadges(snapshot),
      keyFacts: buildStatusFacts(snapshot),
    };
  }

  const vulnerability = result?.summary?.vulnerability;
  if (vulnerability) {
    return buildVulnerabilitySummary(snapshot, vulnerability);
  }

  const findings = result?.findings ?? [];
  const findingCount = findings.length;
  return {
    status: snapshot.meta.status,
    headline:
      findingCount === 0
        ? "No findings detected"
        : `${findingCount} finding${findingCount === 1 ? "" : "s"} detected`,
    disposition: findingCount === 0 ? "clean" : "warning",
    badges: buildStatusBadges(snapshot),
  };
}

function buildVulnerabilitySummary(
  snapshot: ConnectorSnapshot,
  vulnerability: VulnerabilitySummary,
): ConnectorUiSummary {
  const findingCount = vulnerability.findingCount;
  const maxSeverity = vulnerability.maxSeverity;
  const badges: ConnectorUiBadge[] = [
    ...buildStatusBadges(snapshot),
    {
      label:
        maxSeverity === "NONE" ? "No severity" : `${maxSeverity} severity`,
      tone: SEVERITY_TONE[maxSeverity],
    },
  ];

  if (vulnerability.fixAvailable) {
    badges.push({ label: "Fix available", tone: "good" });
  }

  const keyFacts: ConnectorUiFact[] = [
    { label: "Findings", value: String(findingCount) },
  ];

  if (vulnerability.bestFixVersion) {
    keyFacts.push({
      label: "Best fix version",
      value: vulnerability.bestFixVersion,
    });
  }

  return {
    status: snapshot.meta.status,
    headline:
      findingCount === 0
        ? "No findings detected"
        : `${findingCount} finding${findingCount === 1 ? "" : "s"} detected`,
    disposition: severityToDisposition(maxSeverity, findingCount),
    badges,
    keyFacts,
  };
}

export function buildStatusBadges(
  snapshot: ConnectorSnapshot,
): ConnectorUiBadge[] {
  if (snapshot.meta.status === "cache_hit") {
    return [{ label: "Cache hit", tone: "neutral" }];
  }
  if (snapshot.meta.status === "background_pending") {
    return [{ label: "Background pending", tone: "neutral" }];
  }
  return [];
}

export function buildStatusFacts(
  snapshot: ConnectorSnapshot,
): ConnectorUiFact[] {
  const facts: ConnectorUiFact[] = [
    { label: "Status", value: snapshot.meta.status },
  ];

  if (snapshot.meta.errorCode) {
    facts.push({ label: "Error code", value: snapshot.meta.errorCode });
  }

  return facts;
}

export function buildFindingSummaries(
  findings: ConnectorFinding[],
): ConnectorFindingSummary[] {
  return findings.map((finding) => ({
    findingId: finding.findingId,
    severity: finding.severity,
    title: finding.title,
    publishedAt: finding.publishedAt?.toISOString() ?? null,
  }));
}

export function severityToDisposition(
  severity: VulnSeverity,
  findingCount: number,
): ConnectorUiDisposition {
  if (findingCount === 0 || severity === "NONE") {
    return "clean";
  }

  switch (severity) {
    case "CRITICAL":
    case "HIGH":
      return "blocked";
    case "MEDIUM":
      return "elevated";
    case "LOW":
      return "warning";
    default:
      return "clean";
  }
}
