"use client";

import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { getUserErrorMessage } from "@/lib/api-error";
import { canPerform } from "@/lib/dashboard-capabilities";
import { useDashboard } from "@/components/dashboard-provider";
import {
  SeverityBadge,
  FindingStatusBadge,
} from "@/components/policy/policy-badge";
import { StatCard } from "@/components/stat-card";
import type {
  FindingDisposition,
  OsvPackage,
  OsvPackagesPanelProps,
  OsvPackagesResponse,
  OsvSummary,
  VulnDetail,
} from "@/features/findings/types";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const PAGE_LIMIT = 50;

export function OsvPackagesPanel({
  projectId,
  showSummaryCards = true,
  onViolationClick,
  controlledData,
}: OsvPackagesPanelProps) {
  const { role, tenantId } = useDashboard();
  const canManageFindings = !!projectId && canPerform(role, "security.write");
  const canSyncConnector = !!projectId && canPerform(role, "connectors.write");

  const baseUrl = projectId
    ? `/v1/projects/${projectId}`
    : `/v1/tenants/${tenantId}`;
  const isControlled = Boolean(controlledData);

  const [summary, setSummary] = useState<OsvSummary | null>(null);
  const [packages, setPackages] = useState<OsvPackage[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPkg, setExpandedPkg] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [savingFinding, setSavingFinding] = useState<string | null>(null);
  const [findingError, setFindingError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (controlledData) {
      await controlledData.reload();
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [s, p] = await Promise.all([
        apiFetch(`${baseUrl}/connectors/osv/summary`),
        apiFetch(
          `${baseUrl}/connectors/osv/packages?limit=${PAGE_LIMIT}&offset=0`,
        ),
      ]);
      setSummary(s as OsvSummary);
      const pr = p as OsvPackagesResponse;
      setPackages(pr.packages);
      setTotal(pr.pagination.total);
      setOffset(pr.packages.length);
    } catch (err) {
      setError(getUserErrorMessage(err, "Failed to load OSV data"));
    } finally {
      setLoading(false);
    }
  }, [baseUrl, controlledData]);

  useEffect(() => {
    if (isControlled) {
      return;
    }
    void loadData();
  }, [loadData]);

  async function loadMore() {
    if (controlledData) {
      await controlledData.loadMore();
      return;
    }

    setLoadingMore(true);
    try {
      const data = await apiFetch(
        `${baseUrl}/connectors/osv/packages?limit=${PAGE_LIMIT}&offset=${offset}`,
      );
      const pr = data as OsvPackagesResponse;
      setPackages((prev) => [...prev, ...pr.packages]);
      setOffset((prev) => prev + pr.packages.length);
    } catch (err) {
      setError(getUserErrorMessage(err, "Failed to load more"));
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSync() {
    if (!projectId) return;
    setSyncing(true);
    setSyncMsg(null);
    setSyncError(null);
    try {
      const data = (await apiFetch(
        `/v1/projects/${projectId}/connectors/osv/sync`,
        { method: "POST" },
      )) as { newFindings: number; reopened: number };
      setSyncMsg(
        `Sync complete — ${data.newFindings} new findings, ${data.reopened} reopened`,
      );
      await loadData();
    } catch (err) {
      setSyncError(getUserErrorMessage(err, "Sync failed"));
    } finally {
      setSyncing(false);
    }
  }

  function recomputeAgg(findings: FindingDisposition[]): string | null {
    if (findings.length === 0) return null;
    if (findings.some((f) => f.status === "open")) return "open";
    if (findings.every((f) => f.status === "suppressed")) return "suppressed";
    return "resolved";
  }

  async function handleDisposition(
    findingRowId: string,
    status: "suppressed" | "resolved" | "open",
    note: string,
  ) {
    if (!projectId) return;
    setSavingFinding(findingRowId);
    setFindingError(null);
    try {
      await apiFetch(
        `/v1/projects/${projectId}/findings/${findingRowId}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ status, status_note: note.trim() || null }),
        },
      );
      if (controlledData) {
        await controlledData.reload();
        return;
      }
      setPackages((prev) =>
        prev.map((pkg) => ({
          ...pkg,
          findings: pkg.findings.map((f) =>
            f.id === findingRowId
              ? { ...f, status, statusNote: note.trim() || null }
              : f,
          ),
          vulns: pkg.vulns.map((v) =>
            v.disposition?.id === findingRowId
              ? {
                  ...v,
                  disposition: {
                    ...v.disposition,
                    status,
                    statusNote: note.trim() || null,
                  },
                }
              : v,
          ),
          findingStatus: recomputeAgg(
            pkg.findings.map((f) =>
              f.id === findingRowId ? { ...f, status } : f,
            ),
          ),
        })),
      );
    } catch (err) {
      setFindingError(getUserErrorMessage(err, "Failed to update finding"));
    } finally {
      setSavingFinding(null);
    }
  }

  function fmtRelative(iso: string | null) {
    if (!iso) return null;
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  const activeSummary = controlledData?.summary ?? summary;
  const activePackages = controlledData?.packages ?? packages;
  const activeTotal = controlledData?.total ?? total;
  const activeOffset = controlledData?.offset ?? offset;
  const activeLoading = controlledData?.loading ?? loading;
  const activeLoadingMore = controlledData?.loadingMore ?? loadingMore;
  const activeError = controlledData?.error ?? error;

  return (
    <div className="space-y-6">
      {/* Header row — last synced + sync button (project-scoped only) */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-foreground">
          OSV · Open Source Vulnerabilities
          {activeSummary?.lastSyncedAt ? (
            <span className="ml-2 font-normal text-muted-foreground text-xs">
              Last synced {fmtRelative(activeSummary.lastSyncedAt)}
            </span>
          ) : (
            <span className="ml-2 font-normal text-muted-foreground text-xs">
              No manual sync yet
            </span>
          )}
        </p>
        {canSyncConnector && (
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
          >
            {syncing ? "Syncing…" : "Sync OSV"}
          </button>
        )}
      </div>

      {syncMsg && (
        <p className="text-sm text-green-700 dark:text-green-400">{syncMsg}</p>
      )}
      {syncError && <p className="text-sm text-destructive">{syncError}</p>}
      {findingError && (
        <p className="text-sm text-destructive">{findingError}</p>
      )}
      {activeError && (
        <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {activeError}
        </div>
      )}

      {activeLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : activeSummary ? (
        <>
          {showSummaryCards && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard
                label="Total packages"
                value={String(activeSummary.packages.total)}
                sub={`${activeSummary.packages.unscanned} unscanned · ${activeSummary.packages.clean} clean`}
              />
              <StatCard
                label="Vulnerable"
                value={String(activeSummary.packages.vulnerable)}
                sub={`${activeSummary.packages.bySeverity.critical} critical · ${activeSummary.packages.bySeverity.high} high`}
                accent={
                  activeSummary.packages.vulnerable > 0 ? "orange" : undefined
                }
              />
              <StatCard
                label="Fix available"
                value={
                  activeSummary.packages.vulnerable > 0
                    ? `${activeSummary.fixes.available} / ${activeSummary.packages.vulnerable}`
                    : "—"
                }
                sub={
                  activeSummary.fixes.availableNotApplied > 0
                    ? `${activeSummary.fixes.availableNotApplied} not applied`
                    : "all applied"
                }
              />
              <StatCard
                label="Network-exploitable"
                value={String(activeSummary.exploitability.networkExploitable)}
                sub={
                  activeSummary.oldestUnresolvedDays !== null
                    ? `oldest: ${activeSummary.oldestUnresolvedDays}d`
                    : undefined
                }
                accent={
                  activeSummary.exploitability.networkExploitable > 0
                    ? "red"
                    : undefined
                }
              />
            </div>
          )}

          <div>
            <h2 className="mb-3 text-base font-semibold text-foreground">
              Vulnerable packages
              {activeTotal > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({activeTotal})
                </span>
              )}
            </h2>

            {activePackages.length === 0 ? (
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                No vulnerable packages. Proxy traffic or a sync will populate
                this list.
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-border bg-card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="w-6 px-2 py-3" />
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Package
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Version
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Fix version
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Latest
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Severity
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          CVEs
                        </th>
                        {!projectId && (
                          <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                            Projects
                          </th>
                        )}
                        {canManageFindings && (
                          <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                            Findings
                          </th>
                        )}
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
                          Last pulled
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Violations
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {activePackages.map((pkg, idx) => {
                        const key = `${pkg.ecosystem}|${pkg.name}|${pkg.version}`;
                        const isExpanded = expandedPkg === key;
                        const isLast = idx === activePackages.length - 1;

                        return (
                          <React.Fragment key={key}>
                            <tr
                              className={`cursor-pointer hover:bg-muted/30 transition-colors ${!isExpanded && !isLast ? "border-b border-border" : ""}`}
                              onClick={() =>
                                setExpandedPkg(isExpanded ? null : key)
                              }
                            >
                              <td className="px-2 py-3 text-center text-muted-foreground select-none">
                                <span
                                  className={`inline-block transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                                >
                                  ›
                                </span>
                              </td>
                              <td className="px-4 py-3 font-mono font-medium text-foreground">
                                {pkg.name}
                                {pkg.networkExploitable && (
                                  <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                    NET
                                  </span>
                                )}
                              </td>
                              <td
                                className="px-4 py-3 font-mono text-muted-foreground"
                                title={formatReleaseTitle(
                                  "Version",
                                  pkg.versionPublishedAt,
                                )}
                              >
                                {pkg.version}
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-foreground">
                                {pkg.bestFixVersion ??
                                  (pkg.fixAvailable ? (
                                    "available"
                                  ) : (
                                    <span className="text-muted-foreground">
                                      none
                                    </span>
                                  ))}
                              </td>
                              <td
                                className="px-4 py-3 font-mono text-muted-foreground"
                                title={
                                  pkg.latestVersion
                                    ? formatReleaseTitle(
                                        "Latest version",
                                        pkg.latestVersionPublishedAt,
                                      )
                                    : undefined
                                }
                              >
                                {pkg.latestVersion ?? ""}
                              </td>
                              <td className="px-4 py-3">
                                <SeverityBadge severity={pkg.maxSeverity} />
                              </td>
                              <td className="px-4 py-3 text-muted-foreground">
                                {pkg.vulnCount}
                              </td>
                              {!projectId && (
                                <td className="px-4 py-3 text-xs text-muted-foreground">
                                  {pkg.projects && pkg.projects.length > 0
                                    ? pkg.projects.map((p) => p.name).join(", ")
                                    : "—"}
                                </td>
                              )}
                              {canManageFindings && (
                                <td className="px-4 py-3">
                                  {pkg.findingStatus ? (
                                    <FindingStatusBadge
                                      status={pkg.findingStatus}
                                    />
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </td>
                              )}
                              <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                                {pkg.lastPulledAt
                                  ? new Date(
                                      pkg.lastPulledAt,
                                    ).toLocaleDateString()
                                  : "—"}
                              </td>
                              <td
                                className="px-4 py-3"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {pkg.openViolationCount > 0 &&
                                  (onViolationClick ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onViolationClick(
                                          `${pkg.ecosystem}:${pkg.name}:${pkg.version}`,
                                        )
                                      }
                                      className="text-xs text-primary hover:underline"
                                    >
                                      {pkg.openViolationCount}
                                    </button>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      {pkg.openViolationCount}
                                    </span>
                                  ))}
                              </td>
                            </tr>

                            {isExpanded && (
                              <tr
                                className={
                                  !isLast ? "border-b border-border" : ""
                                }
                              >
                                <td />
                                <td
                                  colSpan={
                                    (canManageFindings ? 8 : 7) +
                                    (!projectId ? 1 : 0)
                                  }
                                  className="px-4 pb-4 pt-1"
                                >
                                  <VulnDetailCards
                                    vulns={pkg.vulns}
                                    canManage={canManageFindings}
                                    savingFinding={savingFinding}
                                    onDisposition={handleDisposition}
                                  />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {activeOffset < activeTotal && (
                  <div className="mt-4 text-center">
                    <button
                      type="button"
                      onClick={() => void loadMore()}
                      disabled={activeLoadingMore}
                      className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-muted/50 disabled:opacity-50"
                    >
                      {activeLoadingMore
                        ? "Loading…"
                        : `Load more (${activeTotal - activeOffset} remaining)`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function formatReleaseTitle(label: string, value: string | null) {
  if (!value) return undefined;
  return `${label} released ${new Date(value).toLocaleString()}`;
}

// ---------------------------------------------------------------------------
// VulnDetailCards
// ---------------------------------------------------------------------------

interface VulnDetailCardsProps {
  vulns: VulnDetail[];
  canManage: boolean;
  savingFinding: string | null;
  onDisposition: (
    id: string,
    status: "suppressed" | "resolved" | "open",
    note: string,
  ) => Promise<void>;
}

function VulnDetailCards({
  vulns,
  canManage,
  savingFinding,
  onDisposition,
}: VulnDetailCardsProps) {
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  if (vulns.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No vulnerability detail available.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/10 p-3 space-y-3">
      {/* Source header */}
      <div className="flex items-center gap-2 pb-1 border-b border-border/40">
        <span className="text-xs font-medium text-muted-foreground">
          Advisories
        </span>
        <span className="inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-700/50 dark:bg-blue-900/20 dark:text-blue-400">
          OSV
        </span>
        <span className="text-xs text-muted-foreground/60">
          {vulns.length} {vulns.length === 1 ? "advisory" : "advisories"}
        </span>
      </div>
      <div className="space-y-3">
        {vulns.map((v) => {
          const attrs = v.attributes;
          const osvId = (attrs.osv_id as string | undefined) ?? v.findingId;
          const aliases = (attrs.aliases as string[] | undefined) ?? [];
          const cvssScore = attrs.cvss_v3_score as number | null | undefined;
          const av = attrs.attack_vector as string | null | undefined;
          const fixVer = attrs.fix_version as string | null | undefined;
          const cweIds = (attrs.cwe_ids as string[] | undefined) ?? [];
          const hasExploit = attrs.has_exploit_evidence as boolean | undefined;
          const dispo = v.disposition;
          const isSaving = dispo ? savingFinding === dispo.id : false;
          const isNoting = dispo ? noteFor === dispo.id : false;

          return (
            <div
              key={v.findingId}
              className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <span className="font-mono font-semibold text-foreground">
                    {osvId}
                  </span>
                  {aliases.length > 0 && (
                    <span className="ml-2 text-muted-foreground">
                      {aliases.slice(0, 3).join(" · ")}
                      {aliases.length > 3 && ` +${aliases.length - 3}`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <SeverityBadge severity={v.severity} />
                  {dispo && <FindingStatusBadge status={dispo.status} />}
                </div>
              </div>

              {v.title && (
                <p className="mt-1 text-muted-foreground">{v.title}</p>
              )}

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                {cvssScore !== null && cvssScore !== undefined && (
                  <span>CVSS {Number(cvssScore).toFixed(1)}</span>
                )}
                {av && <span>AV: {av}</span>}
                {fixVer ? (
                  <span className="text-green-700 dark:text-green-400">
                    Fix:{" "}
                    <span className="font-mono font-semibold">{fixVer}</span>
                  </span>
                ) : (
                  <span className="text-orange-600 dark:text-orange-400">
                    No known fix
                  </span>
                )}
                {v.daysSincePublished !== null && (
                  <span>Known {v.daysSincePublished}d</span>
                )}
                {cweIds.length > 0 && (
                  <span>{cweIds.slice(0, 2).join(", ")}</span>
                )}
                {hasExploit && (
                  <span className="text-red-600 dark:text-red-400 font-medium">
                    Exploit evidence
                  </span>
                )}
              </div>

              {canManage && dispo && (
                <div className="mt-2 space-y-2">
                  {isNoting ? (
                    <div className="flex flex-col gap-1.5">
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={1}
                        placeholder="Note (optional)…"
                        className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                      />
                      <div className="flex gap-1.5 flex-wrap">
                        {dispo.status !== "resolved" && (
                          <button
                            type="button"
                            onClick={async () => {
                              await onDisposition(dispo.id, "resolved", note);
                              setNoteFor(null);
                              setNote("");
                            }}
                            disabled={isSaving}
                            className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            Mark resolved
                          </button>
                        )}
                        {dispo.status !== "suppressed" && (
                          <button
                            type="button"
                            onClick={async () => {
                              await onDisposition(dispo.id, "suppressed", note);
                              setNoteFor(null);
                              setNote("");
                            }}
                            disabled={isSaving}
                            className="rounded border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
                          >
                            Suppress
                          </button>
                        )}
                        {dispo.status !== "open" && (
                          <button
                            type="button"
                            onClick={async () => {
                              await onDisposition(dispo.id, "open", "");
                              setNoteFor(null);
                              setNote("");
                            }}
                            disabled={isSaving}
                            className="rounded border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
                          >
                            Re-open
                          </button>
                        )}
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
                        setNoteFor(dispo.id);
                        setNote(dispo.statusNote ?? "");
                      }}
                      className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
                    >
                      Manage
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
