"use client";

import type { ReactNode } from "react";
import {
  ObservationStatusBadge,
  SeverityBadge,
} from "@/components/policy/policy-badge";
import type {
  ContributorFindingSummary,
  FindingDisposition,
  VulnDetail,
} from "@/features/findings/types";

export function SourcePill({
  label,
  tone,
}: {
  label: string;
  tone: "red" | "orange" | "yellow" | "blue" | "muted";
}) {
  const styles: Record<typeof tone, string> = {
    red: "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
    orange:
      "bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400",
    yellow:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
    muted: "bg-muted text-muted-foreground",
  };

  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${styles[tone]}`}
    >
      {label}
    </span>
  );
}

export function ContributorTierPill({
  contributor,
}: {
  contributor: ContributorFindingSummary | null;
}) {
  if (!contributor || contributor.status === "unavailable") {
    return <SourcePill label="Unavailable" tone="muted" />;
  }

  switch (contributor.tier) {
    case "HIGH":
      return <SourcePill label="HIGH" tone="orange" />;
    case "MEDIUM":
      return <SourcePill label="MED" tone="yellow" />;
    case "LOW":
      return <SourcePill label="LOW" tone="blue" />;
    default:
      return <SourcePill label="NONE" tone="muted" />;
  }
}

export function ContributorEvidenceCard({
  contributor,
}: {
  contributor: ContributorFindingSummary | null;
}) {
  if (!contributor || contributor.status === "unavailable") {
    return (
      <DetailCardShell
        title="Contributors"
        badge={<SourcePill label="Unavailable" tone="muted" />}
      >
        <p className="text-xs text-muted-foreground">
          Contributor risk data unavailable for this package version.
        </p>
      </DetailCardShell>
    );
  }

  const summarySignals = buildContributorSignals(contributor);

  return (
    <DetailCardShell
      title="Contributors"
      badge={<ContributorTierPill contributor={contributor} />}
    >
      <div className="grid grid-cols-2 gap-3 text-xs">
        <DetailFact
          label="Score"
          value={contributor.score !== null ? String(contributor.score) : "—"}
        />
        <DetailFact
          label="Publisher"
          value={contributor.publisher ?? "Unknown"}
        />
        <DetailFact
          label="Maintainers"
          value={
            contributor.maintainerCount !== null
              ? String(contributor.maintainerCount)
              : "—"
          }
        />
        <DetailFact
          label="Last scored"
          value={
            contributor.lastScoredAt
              ? new Date(contributor.lastScoredAt).toLocaleDateString()
              : "—"
          }
        />
      </div>

      {summarySignals.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Signals</p>
          <div className="flex flex-wrap gap-1.5">
            {summarySignals.map((signal) => (
              <span
                key={signal}
                className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
              >
                {signal}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No elevated contributor risk signals detected.
        </p>
      )}
    </DetailCardShell>
  );
}

export function IntelligenceEvidenceCard({
  intelligence,
}: {
  intelligence: {
    hasFinding: boolean;
    nearestMatch: string | null;
    recommendedAction: string;
    confidence: string;
    matchQuality: string;
    candidateTrust: string | null;
    llmVerdict: string | null;
    semanticScore: number | null;
    lexicalSimilarityScore: number | null;
    observationStatus: string | null;
    findings: FindingDisposition[];
  } | null;
}) {
  if (!intelligence) {
    return (
      <DetailCardShell
        title="Intelligence"
        badge={<SourcePill label="Unavailable" tone="muted" />}
      >
        <p className="text-xs text-muted-foreground">
          Intelligence data unavailable for this package version.
        </p>
      </DetailCardShell>
    );
  }

  const tone =
    intelligence.recommendedAction === "block"
      ? "red"
      : intelligence.recommendedAction === "review"
        ? "yellow"
        : "muted";

  return (
    <DetailCardShell
      title="Intelligence"
      badge={
        <div className="flex flex-wrap items-center gap-2">
          <SourcePill
            label={intelligence.recommendedAction.toUpperCase()}
            tone={tone}
          />
          {intelligence.observationStatus ? (
            <ObservationStatusBadge status={intelligence.observationStatus} />
          ) : null}
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 text-xs">
        <DetailFact
          label="Nearest match"
          value={intelligence.nearestMatch ?? "—"}
        />
        <DetailFact
          label="Confidence"
          value={intelligence.confidence}
        />
        <DetailFact
          label="Match quality"
          value={intelligence.matchQuality}
        />
        <DetailFact
          label="Candidate trust"
          value={intelligence.candidateTrust ?? "—"}
        />
        <DetailFact
          label="Semantic score"
          value={
            intelligence.semanticScore !== null
              ? intelligence.semanticScore.toFixed(3)
              : "—"
          }
        />
        <DetailFact
          label="Lexical score"
          value={
            intelligence.lexicalSimilarityScore !== null
              ? intelligence.lexicalSimilarityScore.toFixed(3)
              : "—"
          }
        />
      </div>

      {intelligence.llmVerdict ? (
        <p className="text-xs text-muted-foreground">
          {intelligence.llmVerdict}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          No additional intelligence verdict text available.
        </p>
      )}
    </DetailCardShell>
  );
}

export function OsvEvidenceCard({
  vulns,
}: {
  vulns: VulnDetail[];
}) {
  if (vulns.length === 0) {
    return (
      <DetailCardShell
        title="OSV"
        badge={<SourcePill label="NONE" tone="muted" />}
      >
        <p className="text-xs text-muted-foreground">
          No open OSV findings for this package version.
        </p>
      </DetailCardShell>
    );
  }

  return (
    <DetailCardShell
      title="OSV"
      badge={
        <div className="flex flex-wrap items-center gap-2">
          <SourcePill label="OSV" tone="blue" />
          <SourcePill label={`${vulns.length} observed`} tone="blue" />
        </div>
      }
    >
      <div className="space-y-3">
        {vulns.map((vuln) => {
          const attrs = vuln.attributes;
          const osvId = (attrs.osv_id as string | undefined) ?? vuln.findingId;
          const aliases = (attrs.aliases as string[] | undefined) ?? [];
          const cvssScore = attrs.cvss_v3_score as number | null | undefined;
          const attackVector = attrs.attack_vector as string | null | undefined;
          const fixVersion = attrs.fix_version as string | null | undefined;
          const cweIds = (attrs.cwe_ids as string[] | undefined) ?? [];
          const hasExploitEvidence = attrs.has_exploit_evidence as
            | boolean
            | undefined;
          const disposition = vuln.disposition;

          return (
            <div
              key={vuln.findingId}
              className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="font-mono font-semibold text-foreground">
                    {osvId}
                  </span>
                  {aliases.length > 0 ? (
                    <span className="ml-2 text-muted-foreground">
                      {aliases.slice(0, 3).join(" · ")}
                      {aliases.length > 3 ? ` +${aliases.length - 3}` : ""}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <SeverityBadge severity={vuln.severity} />
                  {disposition ? (
                    <ObservationStatusBadge
                      status={disposition.observationStatus}
                    />
                  ) : null}
                </div>
              </div>

              {vuln.title ? (
                <p className="mt-1 text-muted-foreground">{vuln.title}</p>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                {cvssScore !== null && cvssScore !== undefined ? (
                  <span>CVSS {Number(cvssScore).toFixed(1)}</span>
                ) : null}
                {attackVector ? <span>AV: {attackVector}</span> : null}
                {fixVersion ? (
                  <span className="text-green-700 dark:text-green-400">
                    Fix:{" "}
                    <span className="font-mono font-semibold">
                      {fixVersion}
                    </span>
                  </span>
                ) : (
                  <span className="text-orange-600 dark:text-orange-400">
                    No known fix
                  </span>
                )}
                {vuln.daysSincePublished !== null ? (
                  <span>Known {vuln.daysSincePublished}d</span>
                ) : null}
                {cweIds.length > 0 ? (
                  <span>{cweIds.slice(0, 2).join(", ")}</span>
                ) : null}
                {hasExploitEvidence ? (
                  <span className="font-medium text-red-600 dark:text-red-400">
                    Exploit evidence
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </DetailCardShell>
  );
}

function buildContributorSignals(contributor: ContributorFindingSummary) {
  const signals: string[] = [];
  if (contributor.publisherSeenBeforePackage === false) {
    signals.push("first-time publisher");
  }
  if (contributor.publisherMatchesPriorVersion === false) {
    signals.push("publisher changed");
  }
  if ((contributor.newMaintainerCount ?? 0) > 0) {
    signals.push(
      `${contributor.newMaintainerCount} new maintainer${contributor.newMaintainerCount === 1 ? "" : "s"}`,
    );
  }
  if ((contributor.removedMaintainerCount ?? 0) > 0) {
    signals.push(
      `${contributor.removedMaintainerCount} removed maintainer${contributor.removedMaintainerCount === 1 ? "" : "s"}`,
    );
  }
  if (contributor.hasInstallScripts) {
    signals.push("install scripts");
  }
  if (contributor.hasProvenance === false) {
    signals.push("no provenance");
  }
  if (contributor.hasTrustedPublisher) {
    signals.push("trusted publisher");
  }
  return signals;
}

export function DetailCardShell({
  title,
  badge,
  children,
}: {
  title: string;
  badge: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/10 p-3">
      <div className="flex items-center gap-2 border-b border-border/40 pb-1">
        <span className="text-xs font-medium text-muted-foreground">
          {title}
        </span>
        {badge}
      </div>
      {children}
    </div>
  );
}

function DetailFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}
