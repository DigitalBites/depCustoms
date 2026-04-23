/**
 * OSV API response parser.
 *
 * Pure functions — no DB or HTTP dependencies. Converts raw OSV JSON into
 * a structured ConnectorResult with fully extracted intermediate entries.
 *
 */

import semver from "semver";
import type {
  ConnectorResult,
  ConnectorFinding,
  VulnSeverity,
  VulnerabilitySummary,
} from "../types.js";
import { SEVERITY_INDEX } from "../types.js";

// ---------------------------------------------------------------------------
// OSV wire types (internal to this module)
// ---------------------------------------------------------------------------
interface OsvSeverityEntry {
  type: string;
  score: string; // CVSS vector string, e.g. "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N"
}

interface OsvRangeEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
}

interface OsvRange {
  type: string; // SEMVER | ECOSYSTEM | GIT
  events: OsvRangeEvent[];
}

interface OsvAffected {
  package: { ecosystem: string; name: string };
  ranges?: OsvRange[];
}

interface OsvReference {
  type: string; // FIX | EVIDENCE | ARTICLE | REPORT | WEB | GIT | PACKAGE | ADVISORY
  url: string;
}

interface OsvVuln {
  id: string;
  aliases?: string[];
  related?: string[];
  summary?: string;
  severity?: OsvSeverityEntry[];
  affected?: OsvAffected[];
  references?: OsvReference[];
  database_specific?: { cwe_ids?: string[] };
  published?: string;
  modified?: string;
  withdrawn?: string;
}

interface OsvQueryResponse {
  vulns?: OsvVuln[];
}

// Maps our internal ecosystem names to the case-sensitive OSV ecosystem names
// used in advisory `affected[].package.ecosystem` fields.
const OSV_ECOSYSTEM_NAMES: Record<string, string> = {
  npm: "npm",
  pypi: "PyPI",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseOsvResponse(
  raw: unknown,
  pkg: string,
  ecosystem: string,
  _version: string,
): ConnectorResult {
  const response = raw as OsvQueryResponse;
  const vulns = response.vulns ?? [];

  // Resolve the OSV-canonical ecosystem name for filtering affected[] entries.
  // Without this, advisories affecting multiple packages (e.g. lodash + lodash-compat)
  // could return the fix version from the wrong package entry.
  const osvEcosystem =
    OSV_ECOSYSTEM_NAMES[ecosystem.toLowerCase()] ?? ecosystem;
  const parsedVulns = vulns.map((vuln) =>
    parseSingleVuln(vuln, pkg, osvEcosystem),
  );

  // Aggregate fields
  let maxSeverity: VulnSeverity = "NONE";
  let fixAvailable = false;
  // Collect all fix versions and pick the highest — a package may have multiple
  // advisories each fixed at different versions; the user must reach the highest
  // to clear all of them. For semver packages we use semver comparison; for
  // others we take the last non-null fix_version (ordering is not guaranteed).
  const fixVersions: string[] = [];

  for (const v of parsedVulns) {
    if (SEVERITY_INDEX[v.severity] < SEVERITY_INDEX[maxSeverity]) {
      maxSeverity = v.severity;
    }
    if (v.fixAvailable) fixAvailable = true;
    if (v.fixVersion) fixVersions.push(v.fixVersion);
  }

  const bestFixVersion = pickHighestVersion(fixVersions);
  const severityCounts = {
    critical: parsedVulns.filter((v) => v.severity === "CRITICAL").length,
    high: parsedVulns.filter((v) => v.severity === "HIGH").length,
    medium: parsedVulns.filter((v) => v.severity === "MEDIUM").length,
    low: parsedVulns.filter((v) => v.severity === "LOW").length,
  };
  const vulnerabilitySummary: VulnerabilitySummary = {
    maxSeverity,
    findingCount: parsedVulns.length,
    fixAvailable,
    bestFixVersion,
    severityCounts,
  };

  // Build ConnectorFinding[] — generic per-finding records for connector_cache.data JSONB
  const findings: ConnectorFinding[] = parsedVulns.map((v) => ({
    findingId: v.osvId,
    severity: v.severity,
    title: v.summary,
    publishedAt: v.publishedAt,
    attributes: {
      osv_id: v.osvId,
      aliases: v.aliases,
      cvss_v3_score: v.cvssV3Score,
      cvss_v3_vector: v.cvssV3Vector,
      cvss_v4_score: v.cvssV4Score,
      cvss_v4_vector: v.cvssV4Vector,
      attack_vector: v.attackVector,
      attack_complexity: v.attackComplexity,
      privileges_required: v.privilegesRequired,
      user_interaction: v.userInteraction,
      fix_version: v.fixVersion,
      fix_available: v.fixAvailable,
      fix_reference_urls: v.fixReferenceUrls,
      cwe_ids: v.cweIds,
      has_exploit_evidence: v.hasExploitEvidence,
      evidence_urls: v.evidenceUrls,
      withdrawn_at: v.withdrawnAt?.toISOString() ?? null,
    },
  }));

  return {
    summary: {
      vulnerability: vulnerabilitySummary,
    },
    findings,
  };
}

// ---------------------------------------------------------------------------
// Per-vulnerability parsing
// ---------------------------------------------------------------------------

function parseSingleVuln(
  vuln: OsvVuln,
  pkg: string,
  osvEcosystem: string,
): {
  osvId: string;
  aliases: string[];
  summary: string | null;
  severity: VulnSeverity;
  cvssV3Score: number | null;
  cvssV3Vector: string | null;
  cvssV4Score: number | null;
  cvssV4Vector: string | null;
  attackVector: string | null;
  attackComplexity: string | null;
  privilegesRequired: string | null;
  userInteraction: string | null;
  fixVersion: string | null;
  fixAvailable: boolean;
  fixReferenceUrls: string[];
  cweIds: string[];
  hasExploitEvidence: boolean;
  evidenceUrls: string[];
  publishedAt: Date | null;
  modifiedAt: Date | null;
  withdrawnAt: Date | null;
  rawVuln: unknown;
} {
  const {
    score,
    version: cvssVersion,
    vector,
  } = pickBestCvss(vuln.severity ?? []);
  const severity = cvssScoreToSeverity(score);
  const cvssV3Score = cvssVersion === "V3" ? score : null;
  const cvssV3Vec = cvssVersion === "V3" ? vector : null;
  const cvssV4Score = cvssVersion === "V4" ? score : null;
  const cvssV4Vec = cvssVersion === "V4" ? vector : null;

  const exploitability = parseCvssVector(cvssV3Vec ?? cvssV4Vec);

  // extractFixInfo filters affected[] to only entries matching the queried
  // package+ecosystem so we don't return the fix version of a co-affected package.
  const { fixVersion, fixAvailable } = extractFixInfo(
    vuln.affected,
    pkg,
    osvEcosystem,
  );
  const fixReferenceUrls = extractReferenceUrls(vuln.references, "FIX");
  const hasExploitEvidence = (vuln.references ?? []).some(
    (r) => r.type === "EVIDENCE",
  );
  const evidenceUrls = extractReferenceUrls(vuln.references, "EVIDENCE");

  const allIds = new Set<string>([vuln.id, ...(vuln.aliases ?? [])]);
  // Primary osv_id is the canonical record ID; aliases are the rest
  const aliases = [...allIds].filter((id) => id !== vuln.id);

  return {
    osvId: vuln.id,
    aliases,
    summary: vuln.summary ?? null,
    severity,
    cvssV3Score,
    cvssV3Vector: cvssV3Vec,
    cvssV4Score,
    cvssV4Vector: cvssV4Vec,
    attackVector: exploitability.attackVector,
    attackComplexity: exploitability.attackComplexity,
    privilegesRequired: exploitability.privilegesRequired,
    userInteraction: exploitability.userInteraction,
    fixVersion,
    fixAvailable,
    fixReferenceUrls,
    cweIds: vuln.database_specific?.cwe_ids ?? [],
    hasExploitEvidence,
    evidenceUrls,
    publishedAt: vuln.published ? new Date(vuln.published) : null,
    modifiedAt: vuln.modified ? new Date(vuln.modified) : null,
    withdrawnAt: vuln.withdrawn ? new Date(vuln.withdrawn) : null,
    rawVuln: vuln,
  };
}

// ---------------------------------------------------------------------------
// CVSS helpers
// ---------------------------------------------------------------------------

/**
 * Parse a CVSS vector string into a key→value segment map.
 * Shared by computeCvssV3BaseScore and parseCvssVector to avoid parsing twice.
 * Example input: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
 */
function parseCvssSegments(vector: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const segment of vector.split("/")) {
    const idx = segment.indexOf(":");
    if (idx !== -1) parts[segment.slice(0, idx)] = segment.slice(idx + 1);
  }
  return parts;
}

function pickBestCvss(severities: OsvSeverityEntry[]): {
  score: number;
  version: string;
  vector: string | null;
} {
  // Prefer V3 (dominant standard), fall back to V4 (newer but sparse), then V2 (legacy)
  for (const preferred of ["CVSS_V3", "CVSS_V4", "CVSS_V2"] as const) {
    const entry = severities.find((s) => s.type === preferred);
    if (entry) {
      const rawScore = extractNumericScore(entry.score);
      return {
        score: rawScore,
        version:
          preferred === "CVSS_V3"
            ? "V3"
            : preferred === "CVSS_V4"
              ? "V4"
              : "V2",
        vector: entry.score,
      };
    }
  }
  return { score: 0, version: "NONE", vector: null };
}

/**
 * Extract a numeric CVSS base score from an OSV severity entry.
 *
 * OSV `severity[].score` contains the full CVSS vector string, e.g.:
 *   "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
 *
 * The numeric base score is NOT embedded in the vector — it must be computed
 * from the vector components using the CVSS v3 base score formula.
 * For CVSS v2 vectors (no CVSS: prefix) we fall back to a simpler heuristic.
 * Some older OSV records store just a numeric string ("7.2") — we handle that too.
 */
function extractNumericScore(scoreOrVector: string): number {
  // Some records store a bare numeric score string
  const direct = parseFloat(scoreOrVector);
  if (!isNaN(direct) && direct >= 0 && direct <= 10) return direct;

  // CVSS v3 vector: parse components and compute base score
  if (scoreOrVector.startsWith("CVSS:3")) {
    return computeCvssV3BaseScore(scoreOrVector);
  }

  // CVSS v2 or unrecognised — fall back to 0
  return 0;
}

/**
 * Compute the CVSS v3 base score from a vector string.
 * Implements the CVSS v3.1 specification base score formula.
 * https://www.first.org/cvss/v3.1/specification-document (Section 7.1)
 */
function computeCvssV3BaseScore(vector: string): number {
  const parts = parseCvssSegments(vector);

  // Metric numeric weights
  const AV_W: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
  const AC_W: Record<string, number> = { L: 0.77, H: 0.44 };
  const UI_W: Record<string, number> = { N: 0.85, R: 0.62 };
  // PR weight varies by Scope
  const PR_U: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
  const PR_C: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 };
  const CIA_W: Record<string, number> = { N: 0, L: 0.22, H: 0.56 };

  const av = AV_W[parts["AV"]] ?? 0;
  const ac = AC_W[parts["AC"]] ?? 0;
  const ui = UI_W[parts["UI"]] ?? 0;
  const s = parts["S"] ?? "U";
  const pr = (s === "C" ? PR_C : PR_U)[parts["PR"]] ?? 0;
  const c = CIA_W[parts["C"]] ?? 0;
  const i = CIA_W[parts["I"]] ?? 0;
  const a = CIA_W[parts["A"]] ?? 0;

  const exploitability = 8.22 * av * ac * pr * ui;
  const iscBase = 1 - (1 - c) * (1 - i) * (1 - a);

  if (iscBase <= 0) return 0;

  let impact: number;
  if (s === "U") {
    impact = 6.42 * iscBase;
  } else {
    impact = 7.52 * (iscBase - 0.029) - 3.25 * Math.pow(iscBase - 0.02, 15);
  }

  const baseScore =
    s === "U"
      ? Math.min(impact + exploitability, 10)
      : Math.min(1.08 * (impact + exploitability), 10);

  // CVSS v3.1 Roundup: ceiling to 1 decimal place.
  // Pre-round to 5 decimal places to remove floating-point noise before ceiling,
  // avoiding mis-classification at severity boundaries (e.g. 6.9999... → 7.0 not 7.1).
  const int = Math.round(baseScore * 100000);
  return Math.ceil(int / 10000) / 10;
}

function cvssScoreToSeverity(score: number): VulnSeverity {
  if (score >= 9.0) return "CRITICAL";
  if (score >= 7.0) return "HIGH";
  if (score >= 4.0) return "MEDIUM";
  if (score > 0.0) return "LOW";
  return "NONE";
}

/**
 * Parse CVSS v3/v4 vector string to extract exploitability components.
 * Example: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
 */
function parseCvssVector(vector: string | null): {
  attackVector: string | null;
  attackComplexity: string | null;
  privilegesRequired: string | null;
  userInteraction: string | null;
} {
  if (!vector) {
    return {
      attackVector: null,
      attackComplexity: null,
      privilegesRequired: null,
      userInteraction: null,
    };
  }

  const parts = parseCvssSegments(vector);

  const avMap: Record<string, string> = {
    N: "NETWORK",
    A: "ADJACENT",
    L: "LOCAL",
    P: "PHYSICAL",
  };
  const acMap: Record<string, string> = { L: "LOW", H: "HIGH" };
  const prMap: Record<string, string> = { N: "NONE", L: "LOW", H: "HIGH" };
  const uiMap: Record<string, string> = { N: "NONE", R: "REQUIRED" };

  return {
    attackVector: avMap[parts["AV"]] ?? null,
    attackComplexity: acMap[parts["AC"]] ?? null,
    privilegesRequired: prMap[parts["PR"]] ?? null,
    userInteraction: uiMap[parts["UI"]] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Fix intelligence helpers
// ---------------------------------------------------------------------------

/**
 * Extract fix version and fix availability from a vuln's affected[] array,
 * filtering to only entries that match the queried package and ecosystem.
 * Combines the old extractFixVersion + hasLastAffected into a single pass.
 */
function extractFixInfo(
  affected: OsvAffected[] | undefined,
  pkg: string,
  osvEcosystem: string,
): { fixVersion: string | null; fixAvailable: boolean } {
  if (!affected) return { fixVersion: null, fixAvailable: false };

  let fixVersion: string | null = null;
  let hasLastAffected = false;

  for (const a of affected) {
    // Only process entries that match the package we actually queried.
    // An advisory can affect multiple packages; filtering prevents returning
    // the fix version of a co-affected package as the fix for this one.
    if (a.package.ecosystem !== osvEcosystem || a.package.name !== pkg)
      continue;

    for (const range of a.ranges ?? []) {
      if (range.type !== "SEMVER" && range.type !== "ECOSYSTEM") continue;
      for (const event of range.events) {
        if (event.fixed && !fixVersion) fixVersion = event.fixed;
        if (event.last_affected) hasLastAffected = true;
      }
    }
  }

  return { fixVersion, fixAvailable: fixVersion !== null || hasLastAffected };
}

function extractReferenceUrls(
  references: OsvReference[] | undefined,
  type: string,
): string[] {
  return (references ?? []).filter((r) => r.type === type).map((r) => r.url);
}

/**
 * Given a list of fix versions, return the highest one.
 * Uses semver comparison when all versions are valid semver; otherwise falls
 * back to returning the last entry (OSV typically lists newer advisories last).
 * The highest version is returned because a package may have multiple advisories
 * each fixed at different versions — the user must reach the highest to clear all.
 */
function pickHighestVersion(versions: string[]): string | null {
  if (versions.length === 0) return null;
  if (versions.length === 1) return versions[0];

  const cleaned = versions.map((v) => ({
    raw: v,
    clean: semver.valid(semver.coerce(v)),
  }));
  const allSemver = cleaned.every((v) => v.clean !== null);

  if (allSemver) {
    return cleaned.reduce((best, cur) =>
      semver.gt(cur.clean!, best.clean!) ? cur : best,
    ).raw;
  }

  // Non-semver: return the last non-null entry (best-effort)
  return versions[versions.length - 1];
}
