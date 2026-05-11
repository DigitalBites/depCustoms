"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ConnectorAttributeValue } from "@/components/connector-attribute-value";
import { getUserErrorMessage } from "@/lib/api-error";
import { canPerform } from "@/lib/dashboard-capabilities";
import { useDashboard } from "@/components/dashboard-provider";
import {
  SeverityBadge,
  ViolationStatusBadge,
  EnforcementBadge,
} from "@/components/policy/policy-badge";
import type {
  ConnectorFindingField,
  ConnectorPresentation,
  ViolationFinding,
} from "@/features/violations/types";
import { updateFindingStatus } from "@/features/violations/api";
import {
  useViolationDetail,
  useViolationId,
} from "@/features/violations/hooks";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
  HIGH: "bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400",
  MEDIUM:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
  LOW: "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  NONE: "bg-muted text-muted-foreground",
};

function FindingStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    open: "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
    suppressed:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
    resolved:
      "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400",
  };
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${styles[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {status}
    </span>
  );
}

function formatFieldValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return `${value}`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "[value]";
  }
}

function ConnectorPresentationSection({
  presentations,
}: {
  presentations: Record<string, ConnectorPresentation>;
}) {
  const entries = Object.entries(presentations);

  if (entries.length === 0) return null;

  const toneClasses: Record<string, string> = {
    neutral: "bg-muted text-muted-foreground",
    good: "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400",
    warn: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
    bad: "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold text-foreground">
        Connector Summary
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        {entries.map(([connectorKey, presentation]) => (
          <div
            key={connectorKey}
            className="rounded-md border border-border bg-background/50 p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {connectorKey}
                </p>
                <p className="text-sm font-medium text-foreground">
                  {presentation.summary.headline}
                </p>
              </div>
              {typeof presentation.summary.score === "number" && (
                <div className="shrink-0 rounded border border-border px-2 py-1 text-xs font-mono text-foreground">
                  {presentation.summary.score}
                </div>
              )}
            </div>

            {(presentation.summary.badges ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(presentation.summary.badges ?? []).map((badge) => (
                  <span
                    key={`${connectorKey}-${badge.label}`}
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      toneClasses[badge.tone] ?? toneClasses.neutral
                    }`}
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
            )}

            {(presentation.summary.keyFacts ?? []).length > 0 && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                {(presentation.summary.keyFacts ?? []).map((fact) => (
                  <div key={`${connectorKey}-${fact.label}`}>
                    <p className="text-muted-foreground">{fact.label}</p>
                    <p className="text-foreground">{fact.value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Security Findings section
// ---------------------------------------------------------------------------

function SecurityFindingsSection({
  findings,
  findingSchemas,
  projectId,
  onDisposition,
}: {
  findings: ViolationFinding[];
  findingSchemas: Record<string, ConnectorFindingField[]>;
  projectId: string;
  onDisposition: () => void;
}) {
  const { role } = useDashboard();
  const canWriteSecurity = canPerform(role, "security.write");
  const connectorLabel: Record<string, string> = {
    osv: "OSV",
    contributor: "Contributor",
  };

  const [acting, setActing] = useState<string | null>(null); // finding id being actioned
  const [actError, setActError] = useState<string | null>(null);

  async function handleFindingStatus(
    finding: ViolationFinding,
    status: "suppressed" | "resolved",
  ) {
    setActing(finding.id);
    setActError(null);
    try {
      await updateFindingStatus({
        projectId,
        findingId: finding.id,
        status,
        note: "",
      });
      onDisposition();
    } catch (err) {
      setActError(getUserErrorMessage(err, "Failed to update finding"));
    } finally {
      setActing(null);
    }
  }

  if (findings.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Security Findings
        </h2>
        {findings.some((finding) => finding.connector_key === "osv") ? (
          <Link
            href={`/projects/${projectId}/security?tab=findings`}
            className="text-xs text-primary hover:underline"
          >
            View full OSV details →
          </Link>
        ) : null}
      </div>

      {actError && <p className="text-xs text-destructive">{actError}</p>}

      <div className="space-y-3">
        {findings.map((f) => (
          <div
            key={f.id}
            className={`rounded-md border p-3 space-y-2 ${
              f.status === "open"
                ? "border-border"
                : "border-border/50 opacity-75"
            }`}
          >
            {/* Header row */}
            <div className="flex items-start justify-between gap-2 flex-wrap">
              {(() => {
                const attrs = f.advisory?.attributes ?? {};
                const displayId =
                  f.connector_key === "osv"
                    ? ((attrs.osv_id as string | undefined) ?? f.finding_id)
                    : f.finding_id;

                return (
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_COLORS[f.severity] ?? SEVERITY_COLORS.NONE}`}
                    >
                      {f.severity}
                    </span>
                    <FindingStatusBadge status={f.status} />
                    <span className="rounded px-1.5 py-0.5 text-xs bg-muted text-muted-foreground font-mono uppercase">
                      {connectorLabel[f.connector_key] ?? f.connector_key}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {displayId}
                    </span>
                  </div>
                );
              })()}
              {canWriteSecurity && f.status === "open" && (
                <div className="flex gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleFindingStatus(f, "resolved")}
                    disabled={acting === f.id}
                    className="rounded px-2 py-1 text-xs font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    {acting === f.id ? "…" : "Resolve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFindingStatus(f, "suppressed")}
                    disabled={acting === f.id}
                    className="rounded px-2 py-1 text-xs font-medium border border-border text-muted-foreground hover:bg-accent disabled:opacity-50 transition-colors"
                  >
                    Suppress
                  </button>
                </div>
              )}
            </div>

            {/* Title */}
            {f.title && <p className="text-sm text-foreground">{f.title}</p>}

            {/* Connector attributes — rendered from getFindingSchema(), no hardcoded names */}
            {f.advisory?.attributes &&
              (findingSchemas[f.connector_key] ?? []).length > 0 && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                  {(findingSchemas[f.connector_key] ?? []).map((field) => {
                    const val = f.advisory!.attributes[field.key];
                    if (f.connector_key === "osv" && field.key === "osv_id")
                      return null;
                    // Skip nulls, false booleans, and empty arrays — they add no signal
                    if (val === null || val === undefined) return null;
                    if (val === false) return null;
                    if (Array.isArray(val) && val.length === 0) return null;
                    return (
                      <div key={field.key} className="flex flex-col gap-0.5">
                        <span className="text-muted-foreground">
                          {field.label}
                        </span>
                        <ConnectorAttributeValue
                          value={val}
                          display={field.display}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

            {/* Status note */}
            {f.status_note && (
              <p className="text-xs text-muted-foreground italic">
                {f.status_note}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ViolationDetailPage() {
  const { violation_id: rawViolationId } = useParams<{
    violation_id: string;
  }>();
  const violation_id = useViolationId(rawViolationId);
  const { role } = useDashboard();
  const canWriteViolations = canPerform(role, "violations.write");

  // Status update (occurrence-level)
  const [statusNote, setStatusNote] = useState("");
  const [showResolve, setShowResolve] = useState(false);
  const {
    violation,
    loading,
    error,
    loadViolation,
    updating,
    updateError,
    setStatus,
  } = useViolationDetail(violation_id);

  async function handleStatusUpdate(status: "resolved" | "suppressed") {
    const ok = await setStatus(status, statusNote.trim());
    if (ok) {
      setShowResolve(false);
      setStatusNote("");
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  if (loading)
    return <p className="py-8 text-sm text-muted-foreground">Loading…</p>;
  if (error || !violation)
    return (
      <div className="py-8">
        <p className="text-sm text-destructive">
          {error ?? "Violation not found"}
        </p>
        <Link
          href="/violations"
          className="mt-2 inline-block text-sm text-primary hover:underline"
        >
          ← Back to violations
        </Link>
      </div>
    );

  const fieldValues =
    violation.latestEvaluation?.field_values_at_evaluation ?? {};
  const recommendedRemediation = violation.recommended_remediation;
  const hasFindings = violation.findings && violation.findings.length > 0;
  const presentations = violation.presentations ?? {};
  const hasOpenFindings =
    hasFindings && violation.findings.some((f) => f.status === "open");

  return (
    <div className="max-w-3xl space-y-6">
      {/* Breadcrumb */}
      <div>
        <Link
          href="/violations"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Violations
        </Link>
      </div>

      {/* Header */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={violation.severity} />
              <ViolationStatusBadge status={violation.status} />
              <EnforcementBadge mode={violation.enforcement_mode} />
              {violation.blocked && (
                <span className="rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400">
                  blocked
                </span>
              )}
            </div>
            <h1 className="mt-2 text-xl font-semibold text-foreground">
              {violation.message}
            </h1>
            <p className="mt-1 text-xs font-mono text-muted-foreground">
              {violation.code}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Package</p>
            <p className="font-mono text-foreground">{violation.display_name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Entity type</p>
            <p className="text-foreground">{violation.entity_type}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Last evaluated</p>
            <p className="text-foreground">
              {violation.latestEvaluation
                ? formatDate(violation.latestEvaluation.evaluated_at)
                : "No evaluation recorded"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Violation ID</p>
            <p className="font-mono text-xs text-muted-foreground">
              {violation.id}
            </p>
          </div>
          {violation.policy_id && (
            <div>
              <p className="text-xs text-muted-foreground">Policy</p>
              <Link
                href={`/policy-engine/${violation.policy_id}`}
                className="text-primary hover:underline text-sm"
              >
                {violation.policy_name || violation.policy_id}
              </Link>
            </div>
          )}
          {violation.rule_id && (
            <div>
              <p className="text-xs text-muted-foreground">Rule</p>
              <Link
                href={`/policy-engine/${violation.policy_id}/rules/${violation.rule_id}`}
                className="text-primary hover:underline text-sm"
              >
                {violation.rule_name || violation.rule_id}
              </Link>
            </div>
          )}
          {violation.project_name && (
            <div>
              <p className="text-xs text-muted-foreground">Project</p>
              <p className="text-foreground text-sm">
                {violation.project_name}
              </p>
            </div>
          )}
        </div>

        {violation.status_note && (
          <div className="rounded-md bg-muted/30 px-3 py-2">
            <p className="text-xs text-muted-foreground font-medium mb-0.5">
              Note
            </p>
            <p className="text-sm text-foreground">{violation.status_note}</p>
          </div>
        )}

        {recommendedRemediation && (
          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-900/20">
            <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-0.5">
              Recommended remediation
            </p>
            <p className="text-sm text-blue-900 dark:text-blue-200">
              {recommendedRemediation}
            </p>
          </div>
        )}
      </div>

      <ConnectorPresentationSection presentations={presentations} />

      {/* Security Findings — connector intelligence inline */}
      {hasFindings && (
        <SecurityFindingsSection
          findings={violation.findings}
          findingSchemas={violation.findingSchemas ?? {}}
          projectId={violation.project_id}
          onDisposition={loadViolation}
        />
      )}

      {/* Field values at evaluation */}
      {Object.keys(fieldValues).length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground mb-3">
            Field values at evaluation
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            Snapshot of the data that caused this violation. Preserved for audit
            even if connector data has since changed.
          </p>
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Field
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Object.entries(fieldValues).map(([key, val]) => (
                  <tr key={key}>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {key}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-foreground">
                      {val === null ? (
                        <span className="text-muted-foreground italic">
                          null
                        </span>
                      ) : (
                        formatFieldValue(val)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Status management */}
      {canWriteViolations && violation.status === "open" && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">
            Manage status
          </h2>
          {hasOpenFindings && (
            <p className="text-xs text-muted-foreground mb-3">
              Actions apply to this violation and all linked findings for this
              package.
            </p>
          )}

          {showResolve ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Note (optional)
                </label>
                <textarea
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  rows={2}
                  placeholder="Reason for resolving or suppressing…"
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
              {updateError && (
                <p className="text-sm text-destructive">{updateError}</p>
              )}
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleStatusUpdate("resolved")}
                  disabled={updating}
                  className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {updating ? "…" : "Mark resolved"}
                </button>
                <button
                  type="button"
                  onClick={() => handleStatusUpdate("suppressed")}
                  disabled={updating}
                  className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-50 transition-colors"
                >
                  {hasOpenFindings
                    ? "Suppress finding + violation"
                    : "Suppress violation"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowResolve(false);
                    setStatusNote("");
                  }}
                  className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowResolve(true)}
              className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              Update status…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
