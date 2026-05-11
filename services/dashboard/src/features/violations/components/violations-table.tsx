"use client";

import React, { useState } from "react";
import Link from "next/link";
import { getUserErrorMessage } from "@/lib/api-error";
import { ConnectorAttributeValue } from "@/components/connector-attribute-value";
import {
  EnforcementBadge,
  FindingStatusBadge,
  SeverityBadge,
  ViolationStatusBadge,
} from "@/components/policy/policy-badge";
import type {
  ConnectorPresentation,
  EnrichedViolation,
  ExpansionData,
  ViolationFinding,
} from "@/features/violations/types";

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
    <div className="rounded-md border border-border/60 bg-muted/10 p-3">
      <p className="mb-3 text-xs font-medium text-muted-foreground">
        Connector summary
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {entries.map(([connectorKey, presentation]) => (
          <div
            key={connectorKey}
            className="rounded-md border border-border bg-background/60 p-3 space-y-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {connectorKey}
                </p>
                <p className="text-sm font-medium text-foreground">
                  {presentation.summary.headline}
                </p>
              </div>
              {typeof presentation.summary.score === "number" ? (
                <span className="shrink-0 rounded border border-border px-2 py-0.5 text-xs font-mono text-foreground">
                  {presentation.summary.score}
                </span>
              ) : null}
            </div>

            {(presentation.summary.badges ?? []).length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {(presentation.summary.badges ?? []).map((badge) => (
                  <span
                    key={`${connectorKey}-${badge.label}`}
                    className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                      toneClasses[badge.tone] ?? toneClasses.neutral
                    }`}
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
            ) : null}

            {(presentation.summary.keyFacts ?? []).length > 0 ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {(presentation.summary.keyFacts ?? []).map((fact) => (
                  <div key={`${connectorKey}-${fact.label}`}>
                    <p className="text-muted-foreground">{fact.label}</p>
                    <p className="text-foreground">{fact.value}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function FindingsBadge({
  count,
  packageVersionId,
  onNavigate,
}: {
  count: number;
  packageVersionId: string | null;
  onNavigate?: (packageVersionId: string) => void;
}) {
  if (count === 0) return null;

  const cls =
    "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium " +
    "bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400 " +
    "hover:opacity-80 transition-opacity";
  const title = `${count} open finding${count !== 1 ? "s" : ""} for this package`;
  const inner = (
    <>
      <span className="font-mono uppercase opacity-70">osv</span>
      <span>{count}</span>
    </>
  );

  if (onNavigate) {
    return (
      <button
        type="button"
        onClick={() => packageVersionId && onNavigate(packageVersionId)}
        disabled={!packageVersionId}
        className={cls}
        title={title}
      >
        {inner}
      </button>
    );
  }

  return null;
}

function ExpandedViolationContent({
  violation,
  data,
  isAdmin,
  loading,
  onFindingStatus,
  onViolationStatus,
}: {
  violation: EnrichedViolation;
  data: ExpansionData | null;
  isAdmin: boolean;
  loading: boolean;
  onFindingStatus: (
    findingId: string,
    status: "resolved" | "suppressed" | "open",
    note: string,
  ) => Promise<void>;
  onViolationStatus: (
    status: "resolved" | "suppressed",
    note: string,
  ) => Promise<void>;
}) {
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [savingFinding, setSavingFinding] = useState<string | null>(null);
  const [findingError, setFindingError] = useState<string | null>(null);
  const [showManage, setShowManage] = useState(false);
  const [statusNote, setStatusNote] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  if (loading)
    return <p className="py-3 text-xs text-muted-foreground">Loading…</p>;
  if (!data)
    return (
      <p className="py-3 text-xs text-destructive">Failed to load details.</p>
    );

  const { findings, findingSchemas, presentations, field_values_at_evaluation } =
    data;
  const fieldEntries = Object.entries(field_values_at_evaluation ?? {});
  const byConnector = new Map<string, ViolationFinding[]>();
  for (const finding of findings) {
    const arr = byConnector.get(finding.connector_key) ?? [];
    arr.push(finding);
    byConnector.set(finding.connector_key, arr);
  }
  const connectorLabel: Record<string, string> = {
    osv: "OSV",
    contributor: "Contributor",
  };

  async function doFindingStatus(
    findingId: string,
    status: "resolved" | "suppressed" | "open",
    noteText: string,
  ) {
    setSavingFinding(findingId);
    setFindingError(null);
    try {
      await onFindingStatus(findingId, status, noteText);
      setNoteFor(null);
      setNote("");
    } catch (err) {
      setFindingError(getUserErrorMessage(err, "Failed to update finding"));
    } finally {
      setSavingFinding(null);
    }
  }

  async function doViolationStatus(status: "resolved" | "suppressed") {
    setUpdating(true);
    setUpdateError(null);
    try {
      await onViolationStatus(status, statusNote);
      setShowManage(false);
      setStatusNote("");
    } catch (err) {
      setUpdateError(getUserErrorMessage(err, "Failed to update status"));
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="space-y-3 py-2">
      <ConnectorPresentationSection presentations={presentations} />

      {byConnector.size > 0 ? (
        <div className="space-y-4 rounded-md border border-border/60 bg-muted/10 p-3">
          {[...byConnector.entries()].map(([connKey, connFindings]) => (
            <div key={connKey}>
              <div className="mb-3 flex items-center gap-2 border-b border-border/40 pb-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Advisories
                </span>
                <span className="inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-700/50 dark:bg-blue-900/20 dark:text-blue-400">
                  {connectorLabel[connKey] ?? connKey.toUpperCase()}
                </span>
                <span className="text-xs text-muted-foreground/60">
                  {connFindings.length}{" "}
                  {connFindings.length === 1 ? "advisory" : "advisories"}
                </span>
              </div>

              {findingError ? (
                <p className="mb-2 text-xs text-destructive">{findingError}</p>
              ) : null}

              <div className="space-y-2">
                {connFindings.map((finding) => {
                  const schema = findingSchemas[connKey] ?? [];
                  const attrs = finding.advisory?.attributes ?? {};
                  const displayId =
                    connKey === "osv"
                      ? ((attrs.osv_id as string | undefined) ??
                        finding.finding_id)
                      : finding.finding_id;
                  const aliases = (attrs.aliases as string[] | undefined) ?? [];
                  const cvssScore = attrs.cvss_v3_score as
                    | number
                    | null
                    | undefined;
                  const av = attrs.attack_vector as string | null | undefined;
                  const fixVer = attrs.fix_version as string | null | undefined;
                  const cweIds = (attrs.cwe_ids as string[] | undefined) ?? [];
                  const hasExploit = attrs.has_exploit_evidence as
                    | boolean
                    | undefined;
                  const isSaving = savingFinding === finding.id;
                  const isNoting = noteFor === finding.id;
                  const pubAt = finding.advisory?.published_at;
                  const daysSince = pubAt
                    ? Math.floor(
                        (Date.now() - new Date(pubAt).getTime()) /
                          (1000 * 60 * 60 * 24),
                      )
                    : null;
                  const inlineKeys = new Set(
                    connKey === "osv"
                      ? [
                          "osv_id",
                          "aliases",
                          "cvss_v3_score",
                          "attack_vector",
                          "fix_version",
                          "cwe_ids",
                          "has_exploit_evidence",
                        ]
                      : [],
                  );
                  const extraFields = schema.filter((field) => {
                    if (inlineKeys.has(field.key)) return false;
                    const value = attrs[field.key];
                    if (
                      value === null ||
                      value === undefined ||
                      value === false
                    )
                      return false;
                    if (Array.isArray(value) && value.length === 0)
                      return false;
                    return true;
                  });

                  return (
                    <div
                      key={finding.id}
                      className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <span className="font-mono font-semibold text-foreground">
                            {displayId}
                          </span>
                          {connKey === "osv" && aliases.length > 0 ? (
                            <span className="ml-2 text-muted-foreground">
                              {aliases.slice(0, 3).join(" · ")}
                              {aliases.length > 3
                                ? ` +${aliases.length - 3}`
                                : ""}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <SeverityBadge severity={finding.severity} />
                          <FindingStatusBadge status={finding.status} />
                        </div>
                      </div>

                      {finding.title ? (
                        <p className="mt-1 text-muted-foreground">
                          {finding.title}
                        </p>
                      ) : null}

                      {connKey === "osv" ? (
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                          {cvssScore !== null && cvssScore !== undefined ? (
                            <span>CVSS {Number(cvssScore).toFixed(1)}</span>
                          ) : null}
                          {av ? <span>AV: {av}</span> : null}
                          {fixVer ? (
                            <span className="text-green-700 dark:text-green-400">
                              Fix:{" "}
                              <span className="font-mono font-semibold">
                                {fixVer}
                              </span>
                            </span>
                          ) : (
                            <span className="text-orange-600 dark:text-orange-400">
                              No known fix
                            </span>
                          )}
                          {daysSince !== null ? (
                            <span>Known {daysSince}d</span>
                          ) : null}
                          {cweIds.length > 0 ? (
                            <span>{cweIds.slice(0, 2).join(", ")}</span>
                          ) : null}
                          {hasExploit ? (
                            <span className="font-medium text-red-600 dark:text-red-400">
                              Exploit evidence
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      {extraFields.length > 0 ? (
                        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                          {extraFields.map((field) => (
                            <div
                              key={field.key}
                              className="flex flex-col gap-0.5"
                            >
                              <span className="text-muted-foreground">
                                {field.label}
                              </span>
                              <ConnectorAttributeValue
                                value={attrs[field.key]}
                                display={field.display}
                              />
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {isAdmin ? (
                        <div className="mt-2">
                          {isNoting ? (
                            <div className="flex flex-col gap-1.5">
                              <textarea
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                rows={1}
                                placeholder="Note (optional)…"
                                className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                              />
                              <div className="flex flex-wrap gap-1.5">
                                {finding.status !== "resolved" ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void doFindingStatus(
                                        finding.id,
                                        "resolved",
                                        note,
                                      )
                                    }
                                    disabled={isSaving}
                                    className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                                  >
                                    Mark resolved
                                  </button>
                                ) : null}
                                {finding.status !== "suppressed" ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void doFindingStatus(
                                        finding.id,
                                        "suppressed",
                                        note,
                                      )
                                    }
                                    disabled={isSaving}
                                    className="rounded border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
                                  >
                                    Suppress
                                  </button>
                                ) : null}
                                {finding.status !== "open" ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void doFindingStatus(
                                        finding.id,
                                        "open",
                                        "",
                                      )
                                    }
                                    disabled={isSaving}
                                    className="rounded border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
                                  >
                                    Re-open
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setNoteFor(null);
                                    setNote("");
                                  }}
                                  className="rounded border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-accent"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setNoteFor(finding.id);
                                setNote(finding.status_note ?? "");
                              }}
                              className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
                            >
                              Manage
                            </button>
                          )}
                        </div>
                      ) : null}

                      {finding.status_note && !isNoting ? (
                        <p className="mt-1 text-xs italic text-muted-foreground">
                          {finding.status_note}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {fieldEntries.length > 0 ? (
        <div className="rounded-md border border-border/60 bg-muted/10 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Field values at evaluation
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
            {fieldEntries.map(([key, value]) => (
              <div key={key} className="flex flex-col gap-0.5">
                <span className="font-mono text-muted-foreground">{key}</span>
                <span className="font-mono text-foreground">
                  {value === null ? (
                    <span className="italic text-muted-foreground">null</span>
                  ) : (
                    formatFieldValue(value)
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {isAdmin && violation.status === "open" ? (
        <div className="rounded-md border border-border/60 bg-muted/10 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Manage violation
          </p>
          {showManage ? (
            <div className="space-y-2">
              <textarea
                value={statusNote}
                onChange={(e) => setStatusNote(e.target.value)}
                rows={1}
                placeholder="Note (optional)…"
                className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {updateError ? (
                <p className="text-xs text-destructive">{updateError}</p>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => void doViolationStatus("resolved")}
                  disabled={updating}
                  className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Mark resolved
                </button>
                <button
                  type="button"
                  onClick={() => void doViolationStatus("suppressed")}
                  disabled={updating}
                  className="rounded border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
                >
                  {findings.some((finding) => finding.status === "open")
                    ? "Suppress finding + violation"
                    : "Suppress violation"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowManage(false);
                    setStatusNote("");
                    setUpdateError(null);
                  }}
                  className="rounded border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowManage(true)}
              className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
            >
              Update status…
            </button>
          )}
        </div>
      ) : null}

      <div className="flex justify-end pt-1">
        <Link
          href={`/violations/${violation.id}`}
          className="text-xs text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          View full details →
        </Link>
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PAGE_SIZE = 50;

export function ViolationsTable({
  violations,
  canWriteViolations,
  showProjectColumn,
  selectedViolationIds,
  allVisibleSelected,
  hasPartialVisibleSelection,
  expandedId,
  expansionCache,
  expansionErrors,
  loadingExpansion,
  onNavigateToFindings,
  handleExpand,
  handleFindingStatus,
  handleViolationStatus,
  toggleViolationSelection,
  toggleAllVisibleViolations,
  hasMore,
  offset,
  loadViolations,
  loading,
}: {
  violations: EnrichedViolation[];
  canWriteViolations: boolean;
  showProjectColumn: boolean;
  selectedViolationIds: string[];
  allVisibleSelected: boolean;
  hasPartialVisibleSelection: boolean;
  expandedId: string | null;
  expansionCache: Record<string, ExpansionData>;
  expansionErrors: Record<string, string>;
  loadingExpansion: string | null;
  onNavigateToFindings?: (packageVersionId: string) => void;
  handleExpand: (id: string) => void;
  handleFindingStatus: (
    findingId: string,
    status: "resolved" | "suppressed" | "open",
    note: string,
  ) => Promise<void>;
  handleViolationStatus: (
    violationId: string,
    status: "resolved" | "suppressed",
    note: string,
  ) => Promise<void>;
  toggleViolationSelection: (id: string) => void;
  toggleAllVisibleViolations: () => void;
  hasMore: boolean;
  offset: number;
  loadViolations: (offset: number) => Promise<void>;
  loading: boolean;
}) {
  const baseColCount = 9 + (showProjectColumn ? 1 : 0);

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="w-12 px-2 py-2.5 text-left">
                {canWriteViolations ? (
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(node) => {
                      if (node) {
                        node.indeterminate = hasPartialVisibleSelection;
                      }
                    }}
                    onChange={toggleAllVisibleViolations}
                    className="h-4 w-4 rounded border-input accent-primary"
                    aria-label={
                      allVisibleSelected
                        ? "Clear visible violation selection"
                        : "Select visible violations"
                    }
                  />
                ) : null}
              </th>
              <th className="w-8 px-2 py-2.5" />
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Entity
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Rule
              </th>
              {showProjectColumn ? (
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Project
                </th>
              ) : null}
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Severity
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Mode
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Findings
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Status
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Last seen
              </th>
            </tr>
          </thead>
          <tbody>
            {violations.map((violation, idx) => {
              const isExpanded = expandedId === violation.id;
              const isLast = idx === violations.length - 1;
              const isSelected = selectedViolationIds.includes(violation.id);

              return (
                <React.Fragment key={violation.id}>
                  <tr
                    className={`cursor-pointer transition-colors hover:bg-muted/20 ${
                      !isExpanded && !isLast ? "border-b border-border" : ""
                    }`}
                    onClick={() => void handleExpand(violation.id)}
                  >
                    <td
                      className="px-2 py-3 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {canWriteViolations ? (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() =>
                            toggleViolationSelection(violation.id)
                          }
                          className="h-4 w-4 rounded border-input accent-primary"
                          aria-label={`Select violation ${violation.display_name}`}
                        />
                      ) : null}
                    </td>
                    <td className="select-none px-2 py-3 text-center text-muted-foreground">
                      <span
                        className={`inline-block transition-transform duration-150 ${
                          isExpanded ? "rotate-90" : ""
                        }`}
                      >
                        ›
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-foreground">
                        {violation.display_name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-foreground">
                        {violation.rule_name || violation.code}
                      </span>
                    </td>
                    {showProjectColumn ? (
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground">
                          {violation.project_name ?? "—"}
                        </span>
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      <SeverityBadge severity={violation.severity} />
                    </td>
                    <td className="px-4 py-3">
                      <EnforcementBadge mode={violation.enforcement_mode} />
                    </td>
                    <td
                      className="px-4 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <FindingsBadge
                        count={violation.finding_count ?? 0}
                        packageVersionId={violation.package_version_id}
                        onNavigate={onNavigateToFindings}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <ViolationStatusBadge status={violation.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(violation.last_seen_at)}
                    </td>
                  </tr>

                  {isExpanded ? (
                    <tr className={!isLast ? "border-b border-border" : ""}>
                      <td />
                      <td />
                      <td colSpan={baseColCount - 2} className="px-4 pb-4 pt-0">
                        {expansionErrors[violation.id] ? (
                          <p className="py-3 text-xs text-destructive">
                            {expansionErrors[violation.id]}
                          </p>
                        ) : (
                          <ExpandedViolationContent
                            violation={violation}
                            data={expansionCache[violation.id] ?? null}
                            isAdmin={canWriteViolations}
                            loading={loadingExpansion === violation.id}
                            onFindingStatus={handleFindingStatus}
                            onViolationStatus={(status, note) =>
                              handleViolationStatus(violation.id, status, note)
                            }
                          />
                        )}
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasMore ? (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => void loadViolations(offset + PAGE_SIZE)}
            disabled={loading}
            className="rounded-md border border-border px-4 py-1.5 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </>
  );
}
